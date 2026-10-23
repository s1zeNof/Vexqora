"use client";

import { useState, useTransition } from "react";

interface SignalExecutionPanelProps {
  symbol: string;
  side: "long" | "short";
  currentPrice?: number;
  availableBalance: number;
  defaultLeverage?: number;
  defaultRiskPct?: number;
  onExecute: (data: { orderType: "Market" | "Limit"; margin: number; leverage: number }) => Promise<void>;
}

export function SignalExecutionPanel({
  symbol,
  side,
  currentPrice: _currentPrice,
  availableBalance,
  defaultLeverage = 5,
  defaultRiskPct = 1.0,
  onExecute
}: SignalExecutionPanelProps) {
  void _currentPrice;
  const [orderType, setOrderType] = useState<"Market" | "Limit">("Market");
  const [leverage, setLeverage] = useState<number>(defaultLeverage);
  const [margin, setMargin] = useState<number>(100);
  const [customMarginInput, setCustomMarginInput] = useState<string>("100");
  const [isPending, startTransition] = useTransition();
  const [statusMsg, setStatusMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const presets = [25, 50, 100, 250, 500, 1000];

  const handleSelectPreset = (val: number) => {
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

  const estRisk = (margin * 0.025).toFixed(2); // estimated ~2.5% loss on SL

  const handleSubmit = () => {
    setStatusMsg(null);
    startTransition(async () => {
      try {
        await onExecute({ orderType, margin, leverage });
        setStatusMsg({ text: `Signal executed! Position opened on ${symbol}.` });
      } catch (err) {
        setStatusMsg({ text: err instanceof Error ? err.message : "Failed to execute signal", error: true });
      }
    });
  };

  return (
    <div className="cd" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Order Type Tabs & Balance */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <button
          type="button"
          onClick={() => setOrderType("Market")}
          className={`tab ${orderType === "Market" ? "on" : ""}`}
          style={{ padding: "6px 12px" }}
        >
          Market
        </button>
        <button
          type="button"
          onClick={() => setOrderType("Limit")}
          className={`tab ${orderType === "Limit" ? "on" : ""}`}
          style={{ padding: "6px 12px" }}
        >
          Limit
        </button>

        <span className="lb" style={{ marginLeft: "auto", alignSelf: "center", fontVariantNumeric: "tabular-nums" }}>
          Avail {availableBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
        </span>
      </div>

      {/* Risk & Leverage boxes */}
      <div style={{ display: "flex", gap: "8px" }}>
        <div style={{ flex: 1, background: "#1A1A1A", borderRadius: "8px", padding: "8px 12px" }}>
          <div className="lb">Risk</div>
          <div className="v" style={{ margin: "2px 0 0" }}>{defaultRiskPct.toFixed(1)}%</div>
        </div>
        <div style={{ flex: 1, background: "#1A1A1A", borderRadius: "8px", padding: "8px 12px" }}>
          <div className="lb">Leverage</div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
            <select
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              style={{
                background: "transparent",
                border: 0,
                color: "#FFFFFF",
                fontWeight: 600,
                fontSize: "15px",
                padding: 0,
                cursor: "pointer"
              }}
            >
              {[1, 2, 3, 5, 10, 20].map((l) => (
                <option key={l} value={l} style={{ background: "#1A1A1A", color: "#FFFFFF" }}>
                  {l}x
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Quick Margin Presets */}
      <div>
        <div className="lb" style={{ marginBottom: "6px" }}>Position Margin (USDT)</div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => handleSelectPreset(p)}
              className="tab"
              style={{
                padding: "4px 8px",
                fontSize: "12px",
                background: margin === p ? "#1A1A1A" : "transparent",
                border: "1px solid #262626",
                color: margin === p ? "#42F5B9" : "#FFFFFF"
              }}
            >
              ${p}
            </button>
          ))}
        </div>
        <input
          type="number"
          min="5"
          max="50000"
          step="5"
          value={customMarginInput}
          onChange={handleCustomChange}
          placeholder="Custom margin in USDT"
          style={{ width: "100%", padding: "8px 12px", fontSize: "14px" }}
        />
      </div>

      {/* Est. risk summary row */}
      <div className="row" style={{ border: 0, padding: 0 }}>
        <span>Est. risk</span>
        <span style={{ color: "#FF5A6E" }}>~{estRisk} USDT</span>
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

      {/* Execute Button */}
      <button
        type="button"
        disabled={isPending}
        onClick={handleSubmit}
        className="bt pr"
        style={{
          height: "44px",
          fontSize: "15px",
          width: "100%",
          justifyContent: "center"
        }}
      >
        {isPending
          ? "Executing..."
          : `Execute signal · ${side === "long" ? "Long" : "Short"}`}
      </button>
    </div>
  );
}
