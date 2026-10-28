"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { formatCryptoPrice } from "../../../../lib/format";

export interface SignalExecutionPanelProps {
  symbol: string;
  side: "long" | "short";
  currentPrice: number;
  signalEntry?: number | undefined;
  availableBalance: number;
  defaultLeverage?: number | undefined;
  defaultRiskPct?: number | undefined;
  stopLossPrice?: number | undefined;
  tp1Price?: number | undefined;
  tp2Price?: number | undefined;
  tp3Price?: number | undefined;
  lockSignalSide?: boolean | undefined;
  onExecute: (data: {
    orderType: "Market" | "Limit";
    margin: number;
    leverage: number;
    limitPrice?: number | undefined;
    adaptedLevels?: {
      stopLoss: number;
      tp1: number;
      tp2: number;
      tp3: number;
    } | undefined;
  }) => Promise<void>;
}

export function SignalExecutionPanel({
  symbol,
  side: initialSide,
  currentPrice,
  signalEntry,
  availableBalance,
  defaultLeverage = 5,
  defaultRiskPct = 1.0,
  stopLossPrice,
  tp1Price,
  tp2Price,
  tp3Price,
  lockSignalSide = false,
  onExecute
}: SignalExecutionPanelProps) {
  const [side, setSide] = useState<"long" | "short">(initialSide);
  const [orderType, setOrderType] = useState<"Market" | "Limit">("Market");
  const [leverage, setLeverage] = useState<number>(defaultLeverage);
  const initialMargin = availableBalance > 0 ? Number(availableBalance.toFixed(2)) : 10;
  const [margin, setMargin] = useState<number>(initialMargin);
  const [customMarginInput, setCustomMarginInput] = useState<string>(
    availableBalance > 0 ? availableBalance.toFixed(2) : "10"
  );
  const isCustomMarginEdited = useRef(false);

  useEffect(() => {
    if (!isCustomMarginEdited.current && availableBalance > 0) {
      const val = Number(availableBalance.toFixed(2));
      setMargin(val);
      setCustomMarginInput(availableBalance.toFixed(2));
    }
  }, [availableBalance]);
  const [limitPriceInput, setLimitPriceInput] = useState<string>(
    signalEntry && signalEntry > 0 ? signalEntry.toString() : currentPrice.toString()
  );
  const [isAdapted, setIsAdapted] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();
  const [statusMsg, setStatusMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const router = useRouter();
  const isLong = side === "long";
  const baseEntry = signalEntry && signalEntry > 0 ? signalEntry : currentPrice;

  // Real-time drift & milestone evaluations
  const priceDriftPct = baseEntry > 0
    ? ((currentPrice - baseEntry) / baseEntry) * 100 * (isLong ? 1 : -1)
    : 0;

  const isTp1Reached = isLong
    ? (tp1Price ? currentPrice >= tp1Price : false)
    : (tp1Price ? currentPrice <= tp1Price : false);

  const isSlReached = isLong
    ? (stopLossPrice ? currentPrice <= stopLossPrice : false)
    : (stopLossPrice ? currentPrice >= stopLossPrice : false);

  const isHighDrift = priceDriftPct >= 1.2 && !isTp1Reached && !isSlReached;

  // Calculated adaptive levels from the live market price
  const slDist = currentPrice * 0.025;
  const adaptedSL = isLong ? currentPrice - slDist : currentPrice + slDist;
  const adaptedTP1 = isLong ? currentPrice + slDist * 1.8 : currentPrice - slDist * 1.8;
  const adaptedTP2 = isLong ? currentPrice + slDist * 2.6 : currentPrice - slDist * 2.6;
  const adaptedTP3 = isLong ? currentPrice + slDist * 3.5 : currentPrice - slDist * 3.5;

  // Effective execution prices
  const parsedLimit = parseFloat(limitPriceInput);
  const effectiveEntry = orderType === "Market"
    ? currentPrice
    : (!isNaN(parsedLimit) && parsedLimit > 0 ? parsedLimit : baseEntry);

  const effectiveSL = isAdapted
    ? adaptedSL
    : (stopLossPrice ?? (isLong ? effectiveEntry * 0.975 : effectiveEntry * 1.025));

  const effectiveTP1 = isAdapted
    ? adaptedTP1
    : (tp1Price ?? (isLong ? effectiveEntry * 1.045 : effectiveEntry * 0.955));

  const effectiveTP2 = isAdapted
    ? adaptedTP2
    : (tp2Price ?? (isLong ? effectiveEntry * 1.065 : effectiveEntry * 0.935));

  const effectiveTP3 = isAdapted
    ? adaptedTP3
    : (tp3Price ?? (isLong ? effectiveEntry * 1.0875 : effectiveEntry * 0.9125));

  // Effective R:R from current price
  const curRiskDist = Math.abs(currentPrice - (stopLossPrice ?? (isLong ? currentPrice * 0.975 : currentPrice * 1.025)));
  const curRewardDist = Math.abs((tp1Price ?? (isLong ? currentPrice * 1.045 : currentPrice * 0.955)) - currentPrice);
  const effectiveRR = curRiskDist > 0 ? curRewardDist / curRiskDist : 0;

  // Preset handlers
  const presets = availableBalance > 0 && availableBalance <= 100
    ? [
        Math.max(1, Number((availableBalance * 0.25).toFixed(2))),
        Math.max(1, Number((availableBalance * 0.50).toFixed(2))),
        Math.max(1, Number((availableBalance * 0.75).toFixed(2))),
        Number(availableBalance.toFixed(2))
      ]
    : [25, 50, 100, 250, 500, 1000];
  const percentPresets = [10, 25, 50, 100];

  const handleSelectPreset = (val: number) => {
    isCustomMarginEdited.current = true;
    setMargin(val);
    setCustomMarginInput(val.toString());
  };

  const handleSelectPercent = (pct: number) => {
    isCustomMarginEdited.current = true;
    const rawVal = availableBalance * (pct / 100);
    const val = Math.max(0.1, Number(rawVal.toFixed(2)));
    setMargin(val);
    setCustomMarginInput(val.toString());
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    isCustomMarginEdited.current = true;
    const val = e.target.value;
    setCustomMarginInput(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed > 0) {
      setMargin(parsed);
    }
  };

  // Calculations
  const notionalSize = margin * leverage;
  const approxQty = effectiveEntry > 0 ? notionalSize / effectiveEntry : 0;

  // Liquidation calculation
  const maintenanceMarginRate = 0.005;
  const liqDistance = leverage > 1 ? effectiveEntry * (1 / leverage - maintenanceMarginRate) : effectiveEntry * 0.9;
  const estLiqPrice = isLong ? Math.max(0, effectiveEntry - liqDistance) : effectiveEntry + liqDistance;

  // SL & TP Diff
  const slDiffPct = effectiveEntry > 0 ? Math.abs((effectiveEntry - effectiveSL) / effectiveEntry) * 100 : 2.5;
  const tpDiffPct = effectiveEntry > 0 ? Math.abs((effectiveTP1 - effectiveEntry) / effectiveEntry) * 100 : 4.5;
  const estSlLossUsdt = (margin * (slDiffPct / 100) * leverage).toFixed(2);
  const estTpGainUsdt = (margin * (tpDiffPct / 100) * leverage).toFixed(2);

  const handleSubmit = () => {
    setStatusMsg(null);
    startTransition(async () => {
      try {
        const mustAdapt = isAdapted || (orderType === "Market" && (isTp1Reached || isSlReached));
        await onExecute({
          orderType,
          margin,
          leverage,
          limitPrice: orderType === "Limit" ? effectiveEntry : undefined,
          adaptedLevels: mustAdapt ? {
            stopLoss: adaptedSL,
            tp1: adaptedTP1,
            tp2: adaptedTP2,
            tp3: adaptedTP3
          } : {
            stopLoss: effectiveSL,
            tp1: effectiveTP1,
            tp2: effectiveTP2,
            tp3: effectiveTP3
          }
        });

        const entryLabel = orderType === "Market"
          ? `по ринку @ $${formatCryptoPrice(currentPrice)}`
          : `Limit @ $${formatCryptoPrice(effectiveEntry)}`;
        setStatusMsg({
          text: `Ордер успішно розміщено! ${side.toUpperCase()} ${symbol} ${entryLabel} на $${margin} (${leverage}x).`
        });
        router.refresh();
      } catch (err) {
        setStatusMsg({
          text: err instanceof Error ? err.message : "Помилка відкриття ордера",
          error: true
        });
      }
    });
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
      {/* Terminal Title & Live Price Comparison */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <b style={{ font: "700 15px 'Plus Jakarta Sans', sans-serif", color: "#F1EEFF" }}>
          Торговий термінал
        </b>
        <span
          className="tg gy"
          style={{
            fontSize: "11px",
            color: "#35F2D0",
            border: "1px solid #35F2D044",
            fontFamily: "'JetBrains Mono', monospace"
          }}
        >
          ● Live: ${formatCryptoPrice(currentPrice)}
        </span>
      </div>

      {/* Signal vs Live Price Bar */}
      {signalEntry && signalEntry > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#171229",
            border: "1px solid #2A2145",
            borderRadius: "8px",
            padding: "8px 12px",
            fontSize: "12px"
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span className="lb" style={{ fontSize: "10px" }}>Ціна сигналу</span>
            <span style={{ fontWeight: 600, color: "#FFFFFF", fontFamily: "'JetBrains Mono', monospace" }}>
              ${formatCryptoPrice(signalEntry)}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ color: "#7C4DFF" }}>➔</span>
            <span
              className="tg"
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: priceDriftPct >= 0 ? "#35F2D0" : "#FF4F9A",
                background: priceDriftPct >= 0 ? "rgba(53, 242, 208, 0.12)" : "rgba(255, 79, 154, 0.12)",
                fontFamily: "'JetBrains Mono', monospace"
              }}
            >
              {priceDriftPct >= 0 ? "+" : ""}{priceDriftPct.toFixed(2)}%
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span className="lb" style={{ fontSize: "10px" }}>Поточна ціна</span>
            <span style={{ fontWeight: 700, color: "#35F2D0", fontFamily: "'JetBrains Mono', monospace" }}>
              ${formatCryptoPrice(currentPrice)}
            </span>
          </div>
        </div>
      )}

      {/* Nemotron AI Intelligence & Advisory Banner */}
      {isTp1Reached ? (
        <div
          style={{
            background: "rgba(124, 77, 255, 0.12)",
            border: "1px solid #7C4DFF",
            borderRadius: "10px",
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ font: "700 12px 'Plus Jakarta Sans', sans-serif", color: "#B9A2FF" }}>
              🤖 ШІ Nemotron · Ризик-контроль
            </span>
            <span
              className="tg"
              style={{
                fontSize: "10px",
                background: "#7C4DFF",
                color: "#FFFFFF",
                fontWeight: 700
              }}
            >
              🎯 TP1 досягнуто!
            </span>
          </div>

          <p style={{ margin: 0, fontSize: "12px", color: "#F1EEFF", lineHeight: 1.45 }}>
            Ціна вже досягла першої цілі <b>${formatCryptoPrice(tp1Price ?? 0)}</b> ({priceDriftPct >= 0 ? "+" : ""}{priceDriftPct.toFixed(2)}%). Вхід за старими цілями заблоковано, оскільки сетап частково відпрацював.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "2px" }}>
            <button
              type="button"
              onClick={() => {
                setIsAdapted(true);
                setOrderType("Market");
              }}
              className="bt sm"
              style={{
                background: isAdapted ? "#35F2D0" : "linear-gradient(135deg, #7C4DFF, #B24BFF)",
                color: isAdapted ? "#07050F" : "#FFFFFF",
                fontWeight: 700,
                fontSize: "11px",
                padding: "8px 10px",
                borderRadius: "6px",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between"
              }}
            >
              <span>{isAdapted ? "✓ Цілі адаптовано!" : "🎯 Адаптувати цілі під поточну ціну"}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px" }}>
                TP1: ${formatCryptoPrice(adaptedTP1)}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsAdapted(false);
                setOrderType("Limit");
                if (signalEntry) setLimitPriceInput(signalEntry.toString());
              }}
              className="bt sm"
              style={{
                background: orderType === "Limit" && !isAdapted ? "#171229" : "transparent",
                border: "1px solid #2A2145",
                color: "#A59CC4",
                fontWeight: 600,
                fontSize: "11px",
                padding: "6px 10px",
                borderRadius: "6px",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between"
              }}
            >
              <span>⏳ Чекати ретест (Limit ордер)</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "10px" }}>
                ${formatCryptoPrice(baseEntry)}
              </span>
            </button>
          </div>
        </div>
      ) : isSlReached ? (
        <div
          style={{
            background: "rgba(255, 79, 154, 0.12)",
            border: "1px solid #FF4F9A",
            borderRadius: "10px",
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ font: "700 12px 'Plus Jakarta Sans', sans-serif", color: "#FF4F9A" }}>
              ⛔ ШІ Nemotron · Сетап інвалідовано
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "12px", color: "#F1EEFF", lineHeight: 1.4 }}>
            Ціна пробила захисний Stop Loss (${formatCryptoPrice(stopLossPrice ?? 0)}). Первинний сетап скасовано ринком. Вхід за старим сигналом не рекомендується.
          </p>
          <button
            type="button"
            onClick={() => {
              setIsAdapted(true);
              setOrderType("Market");
            }}
            className="bt sm"
            style={{
              background: "#171229",
              border: "1px solid #FF4F9A66",
              color: "#FF4F9A",
              fontWeight: 700,
              fontSize: "11px",
              padding: "6px 10px",
              marginTop: "4px"
            }}
          >
            🔄 Сформувати новий вхід від поточної ціни ($${formatCryptoPrice(currentPrice)})
          </button>
        </div>
      ) : isHighDrift ? (
        <div
          style={{
            background: "rgba(255, 194, 75, 0.1)",
            border: "1px solid #FFC24B",
            borderRadius: "10px",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ font: "700 12px 'Plus Jakarta Sans', sans-serif", color: "#FFC24B" }}>
              ⚠️ ШІ Nemotron: Зсув ціни (+{priceDriftPct.toFixed(1)}%)
            </span>
            <span style={{ fontSize: "11px", color: "#FFC24B", fontWeight: 700 }}>
              R:R 1:{effectiveRR.toFixed(2)}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "11.5px", color: "#A59CC4", lineHeight: 1.4 }}>
            Ціна вже частково пройшла шлях до цілі. Потенціал скоротився, а ризик зріс.
          </p>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              onClick={() => setIsAdapted(!isAdapted)}
              className="bt sm"
              style={{
                flex: 1,
                fontSize: "11px",
                background: isAdapted ? "#35F2D0" : "#171229",
                color: isAdapted ? "#07050F" : "#FFFFFF",
                border: "1px solid #2A2145"
              }}
            >
              {isAdapted ? "✓ Рівні підтягнуто" : "🎯 Підтягнути рівні"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOrderType("Limit");
                if (signalEntry) setLimitPriceInput(signalEntry.toString());
              }}
              className="bt sm"
              style={{
                flex: 1,
                fontSize: "11px",
                background: orderType === "Limit" ? "#171229" : "transparent",
                color: "#A59CC4",
                border: "1px solid #2A2145"
              }}
            >
              ⏳ Limit ордер
            </button>
          </div>
        </div>
      ) : null}

      {/* Direction Switcher (LONG / SHORT) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
        <button
          type="button"
          onClick={() => setSide("long")}
          disabled={lockSignalSide}
          style={{
            height: "36px",
            font: "700 13px 'JetBrains Mono', monospace",
            borderRadius: "6px",
            cursor: lockSignalSide ? "not-allowed" : "pointer",
            border: isLong ? "1px solid #35F2D0" : "1px solid #2A2145",
            background: isLong ? "#35F2D0" : "#171229",
            color: isLong ? "#07050F" : "#A59CC4"
          }}
        >
          LONG
        </button>
        <button
          type="button"
          onClick={() => setSide("short")}
          disabled={lockSignalSide}
          style={{
            height: "36px",
            font: "700 13px 'JetBrains Mono', monospace",
            borderRadius: "6px",
            cursor: lockSignalSide ? "not-allowed" : "pointer",
            border: !isLong ? "1px solid #FF4F9A" : "1px solid #2A2145",
            background: !isLong ? "#FF4F9A" : "#171229",
            color: !isLong ? "#FFFFFF" : "#A59CC4"
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
            style={{ padding: "5px 12px", fontSize: "12px", fontWeight: 600 }}
          >
            Market (По ринку)
          </button>
          <button
            type="button"
            onClick={() => setOrderType("Limit")}
            className={`tab ${orderType === "Limit" ? "on" : ""}`}
            style={{ padding: "5px 12px", fontSize: "12px", fontWeight: 600 }}
          >
            Limit (У стакан)
          </button>
        </div>

        <span className="lb" style={{ fontSize: "12px", fontVariantNumeric: "tabular-nums" }}>
          Баланс: <b style={{ color: "#FFFFFF" }}>${availableBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
        </span>
      </div>

      {/* Limit Price Input if orderType === "Limit" */}
      {orderType === "Limit" && (
        <div
          style={{
            background: "#171229",
            borderRadius: "8px",
            padding: "10px 12px",
            border: "1px solid #2A2145"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
            <span className="lb" style={{ fontSize: "11px" }}>Ціна Limit ордера</span>
            <button
              type="button"
              onClick={() => {
                if (signalEntry) setLimitPriceInput(signalEntry.toString());
              }}
              style={{
                background: "transparent",
                border: 0,
                color: "#7C4DFF",
                fontSize: "11px",
                cursor: "pointer",
                padding: 0
              }}
            >
              Встановити ціну сигналу (${formatCryptoPrice(baseEntry)})
            </button>
          </div>
          <div style={{ position: "relative" }}>
            <input
              type="number"
              step="any"
              value={limitPriceInput}
              onChange={(e) => setLimitPriceInput(e.target.value)}
              placeholder="Ціна входу"
              style={{
                width: "100%",
                height: "36px",
                padding: "0 55px 0 10px",
                fontSize: "14px",
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                background: "#0E0B1A",
                border: "1px solid #2A2145",
                borderRadius: "6px",
                color: "#FFFFFF"
              }}
            />
            <span
              style={{
                position: "absolute",
                right: "10px",
                top: "8px",
                color: "#A59CC4",
                fontSize: "12px",
                fontFamily: "'JetBrains Mono', monospace"
              }}
            >
              USDT
            </span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "11px", color: "#A59CC4" }}>
            {isLong && currentPrice > effectiveEntry ? (
              <span>⏳ Ціна вище ліміту. Ордер чекатиме корекції до <b>${formatCryptoPrice(effectiveEntry)}</b>.</span>
            ) : !isLong && currentPrice < effectiveEntry ? (
              <span>⏳ Ціна нижче ліміту. Ордер чекатиме підйому до <b>${formatCryptoPrice(effectiveEntry)}</b>.</span>
            ) : (
              <span style={{ color: "#35F2D0" }}>⚡ Ціна вже на рівні ліміту. Ордер виконається миттєво.</span>
            )}
          </p>
        </div>
      )}

      {/* Leverage Selector & Risk pill */}
      <div style={{ display: "flex", gap: "8px" }}>
        <div style={{ flex: 1, background: "#171229", borderRadius: "8px", padding: "8px 12px", border: "1px solid #2A2145" }}>
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
                outline: "none",
                fontFamily: "'JetBrains Mono', monospace"
              }}
            >
              {[1, 2, 3, 5, 10, 20, 50].map((l) => (
                <option key={l} value={l} style={{ background: "#171229", color: "#FFFFFF" }}>
                  {l}x Cross
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ flex: 1, background: "#171229", borderRadius: "8px", padding: "8px 12px", border: "1px solid #2A2145" }}>
          <div className="lb" style={{ fontSize: "11px" }}>Ризик на угоду</div>
          <div className="v" style={{ margin: "4px 0 0", fontSize: "14px", fontFamily: "'JetBrains Mono', monospace" }}>
            {defaultRiskPct.toFixed(1)}% балансу
          </div>
        </div>
      </div>

      {/* Margin Input & Presets */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
          <span className="lb" style={{ fontSize: "12px" }}>Сума маржі (USDT)</span>
          <span className="lb" style={{ fontSize: "11px", color: "#A59CC4" }}>
            Плече: {leverage}x
          </span>
        </div>

        {/* Currency Input Field */}
        <div style={{ position: "relative", marginBottom: "8px" }}>
          <input
            type="number"
            min="0.1"
            max="100000"
            step="any"
            value={customMarginInput}
            onChange={handleCustomChange}
            placeholder="Введіть суму"
            style={{
              width: "100%",
              height: "40px",
              padding: "0 55px 0 12px",
              fontSize: "15px",
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
              background: "#171229",
              border: "1px solid #2A2145",
              borderRadius: "6px",
              color: "#FFFFFF"
            }}
          />
          <span
            style={{
              position: "absolute",
              right: "12px",
              top: "10px",
              color: "#A59CC4",
              font: "600 13px 'JetBrains Mono', monospace"
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
                fontFamily: "'JetBrains Mono', monospace",
                background: margin === p ? "#2A2145" : "transparent",
                border: "1px solid #2A2145",
                color: margin === p ? "#35F2D0" : "#FFFFFF"
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
                fontFamily: "'JetBrains Mono', monospace",
                background: "transparent",
                border: "1px solid #2A2145",
                color: "#A59CC4"
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
          background: "#171229",
          borderRadius: "8px",
          padding: "12px",
          border: "1px solid #2A2145",
          display: "flex",
          flexDirection: "column",
          gap: "8px"
        }}
      >
        <div className="row" style={{ padding: "2px 0", border: 0 }}>
          <span className="lb" style={{ fontSize: "12px" }}>Ціна входу</span>
          <span className="v" style={{ fontSize: "13px", color: "#F1EEFF", fontFamily: "'JetBrains Mono', monospace" }}>
            ${formatCryptoPrice(effectiveEntry)} {orderType === "Market" ? "(Зараз по ринку)" : "(Limit)"}
          </span>
        </div>
        <div className="row" style={{ padding: "2px 0", border: 0 }}>
          <span className="lb" style={{ fontSize: "12px" }}>Розмір позиції</span>
          <span className="v" style={{ fontSize: "13px", fontFamily: "'JetBrains Mono', monospace" }}>
            ${notionalSize.toFixed(2)} USDT ({approxQty.toFixed(approxQty >= 10 ? 2 : 4)} {symbol.replace("USDT", "")})
          </span>
        </div>
        <div className="row" style={{ padding: "2px 0", border: 0 }}>
          <span className="lb" style={{ fontSize: "12px" }}>Ціна ліквідації</span>
          <span className="v" style={{ fontSize: "13px", color: "#FFC24B", fontFamily: "'JetBrains Mono', monospace" }}>
            ${formatCryptoPrice(estLiqPrice)}
          </span>
        </div>
        <div className="row" style={{ padding: "2px 0", border: 0 }}>
          <span className="lb" style={{ fontSize: "12px" }}>
            Прибуток на TP1 ({effectiveTP1 ? `$${formatCryptoPrice(effectiveTP1)}` : `+${tpDiffPct.toFixed(1)}%`})
          </span>
          <span className="v" style={{ fontSize: "13px", color: "#35F2D0", fontFamily: "'JetBrains Mono', monospace" }}>
            +${estTpGainUsdt} USDT
          </span>
        </div>
        <div className="row" style={{ padding: "2px 0", border: 0 }}>
          <span className="lb" style={{ fontSize: "12px" }}>
            Ризик на SL ({effectiveSL ? `$${formatCryptoPrice(effectiveSL)}` : `-${slDiffPct.toFixed(1)}%`})
          </span>
          <span className="v" style={{ fontSize: "13px", color: "#FF4F9A", fontFamily: "'JetBrains Mono', monospace" }}>
            -${estSlLossUsdt} USDT
          </span>
        </div>
      </div>

      {/* Status Notice */}
      {statusMsg && (
        <div
          className="notice"
          style={{
            color: statusMsg.error ? "#FF4F9A" : "#35F2D0",
            borderColor: statusMsg.error ? "#FF4F9A44" : "#35F2D044",
            background: statusMsg.error ? "rgba(255, 79, 154, 0.1)" : "rgba(53, 242, 208, 0.1)",
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
        disabled={isPending || (isSlReached && !isAdapted)}
        onClick={handleSubmit}
        style={{
          minHeight: "46px",
          height: "auto",
          padding: "10px 14px",
          width: "100%",
          borderRadius: "8px",
          font: "700 14px 'Plus Jakarta Sans', sans-serif",
          cursor: isPending || (isSlReached && !isAdapted) ? "not-allowed" : "pointer",
          border: 0,
          background: isPending || (isSlReached && !isAdapted)
            ? "#2A2145"
            : (orderType === "Market"
                ? (isLong ? "#35F2D0" : "#FF4F9A")
                : "linear-gradient(135deg, #7C4DFF, #B24BFF)"),
          color: isPending || (isSlReached && !isAdapted)
            ? "#8E88A8"
            : (orderType === "Market" && isLong ? "#07050F" : "#FFFFFF"),
          transition: "opacity 0.15s ease",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          whiteSpace: "normal",
          lineHeight: 1.3,
          gap: "8px"
        }}
      >
        {isPending
          ? "⏳ Відкриваю ордер..."
          : isSlReached && !isAdapted
            ? "⛔ Сетап інвалідовано (Stop Loss пробито)"
            : orderType === "Market"
              ? (isAdapted || isTp1Reached
                  ? `⚡ Відкрити ${isLong ? "LONG" : "SHORT"} за $${formatCryptoPrice(currentPrice)} з новими TP`
                  : `⚡ Відкрити ${isLong ? "LONG" : "SHORT"} по ринку ($${formatCryptoPrice(currentPrice)})`)
              : `⏳ Виставити Limit ${isLong ? "LONG" : "SHORT"} на $${formatCryptoPrice(effectiveEntry)}`}
      </button>
    </div>
  );
}
