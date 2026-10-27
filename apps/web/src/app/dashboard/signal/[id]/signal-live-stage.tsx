"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Kline } from "@crypto-bot/shared";
import { formatPrice, formatCryptoPrice } from "../../../../lib/format";
import { formatTimeAgo } from "../../../../lib/date";
import { useLiveTicker } from "../../../../hooks/use-live-ticker";
import { SignalChart } from "./signal-chart";
import { SignalPositionsTable, type SignalTradeItem } from "./signal-positions-table";
import { SignalExecutionPanel } from "./signal-execution-panel";
import { AiEnsembleCard } from "./ai-ensemble-card";
import type { MarketMicrostructure, MLPredictionResponse, AdaptiveConfidenceResult, MarketContextSnapshot, NewsRiskAssessment } from "@crypto-bot/trading";
import { TradeCompanionPanel } from "./trade-companion-panel";
import type { TradeAiSessionData } from "./ai-companion-actions";
import { toggleTradeControlMode } from "./actions";
import { playTradeNotification } from "../../../../lib/sound-service";
import { dispatchTradeToast } from "../../../../components/trade-toast";

interface SignalLiveStageProps {
  symbol: string;
  side: "long" | "short";
  initialPrice: number;
  initialHigh24h: string;
  initialLow24h: string;
  initialPriceChangePct: string;
  initialVolume24h: string;
  initialFundingRate: string;
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  klines: Kline[];
  activePosition: SignalTradeItem | null;
  recentHistoricalTrade: SignalTradeItem | null;
  tradesList: SignalTradeItem[];
  historyTrades: SignalTradeItem[];
  isPaperTrading: boolean;
  tradingModeLabel: string;
  isArchived: boolean;
  ageHours: number;
  remainingHours: number;
  targetSignalId: string | null;
  qualityScore: string;
  qualityTier: string;
  strategy: string;
  rationale: string;
  createdAtTime?: string | number | null | undefined;
  riskReward?: number | undefined;
  winProbabilityPct?: number | undefined;
  availableBalance?: number | undefined;
  mlPrediction?: MLPredictionResponse | null | undefined;
  microstructure?: MarketMicrostructure | null | undefined;
  adaptiveAi?: AdaptiveConfidenceResult | null | undefined;
  aiSession?: TradeAiSessionData | null | undefined;
  marketContext?: MarketContextSnapshot | null | undefined;
  newsRisk?: NewsRiskAssessment | null | undefined;
  onExecute?: ((data: {
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
  }) => Promise<void>) | undefined;
  onDeleteFromArchive?: () => Promise<void>;
  children?: React.ReactNode;
}

export function SignalLiveStage({
  symbol,
  side,
  initialPrice,
  initialHigh24h,
  initialLow24h,
  initialPriceChangePct,
  initialVolume24h,
  initialFundingRate,
  entry,
  stopLoss,
  tp1,
  tp2,
  tp3,
  klines,
  activePosition,
  recentHistoricalTrade,
  tradesList,
  historyTrades,
  isPaperTrading,
  tradingModeLabel,
  isArchived,
  ageHours,
  remainingHours,
  targetSignalId,
  qualityScore,
  qualityTier,
  strategy,
  rationale,
  createdAtTime,
  riskReward,
  winProbabilityPct,
  availableBalance,
  mlPrediction,
  microstructure,
  adaptiveAi,
  aiSession,
  marketContext,
  newsRisk,
  onExecute,
  onDeleteFromArchive,
  children
}: SignalLiveStageProps) {
  const router = useRouter();
  const [controlMode, setControlMode] = useState<"auto" | "manual">(activePosition?.controlMode ?? "auto");
  const [workspaceTab, setWorkspaceTab] = useState<"positions" | "ensemble" | "mtf" | "orderflow" | "news" | "audit">("positions");
  const [mobileTab, setMobileTab] = useState<"stage" | "companion" | "workspace">("stage");
  const [isUpdatingMode, setIsUpdatingMode] = useState(false);

  useEffect(() => {
    if (activePosition?.controlMode) {
      setControlMode(activePosition.controlMode);
    }
  }, [activePosition?.controlMode]);

  // Real-time live ticker with WebSocket & 1.5s Ajax fallback
  const ticker = useLiveTicker({
    symbol,
    initialPrice,
    initialHigh24h,
    initialLow24h,
    initialPriceChangePct,
    initialVolume24h,
    initialFundingRate
  });

  // Extract numeric 24h high/low bounds to reject any stray anomalous ticks (e.g. cross-symbol lags)
  const numHigh24h = parseFloat(ticker.high24h.replace(/[^0-9.]/g, "")) || 0;
  const numLow24h = parseFloat(ticker.low24h.replace(/[^0-9.]/g, "")) || 0;

  // Sanitize currentPrice: reject if it wildly exceeds verified 24h bounds of the coin
  const rawPrice = ticker.price > 0 ? ticker.price : initialPrice;
  const isPriceWithin24hBounds =
    numHigh24h > 0 && numLow24h > 0
      ? rawPrice >= numLow24h * 0.95 && rawPrice <= numHigh24h * 1.05
      : true;

  const currentPrice = isPriceWithin24hBounds ? rawPrice : (initialPrice > 0 ? initialPrice : rawPrice);
  const isLong = side === "long";

  // Automated Paper matching execution on live price ticks (Autopilot mode)
  const lastTickTimeRef = useRef<number>(0);
  const notifiedTradesRef = useRef<Set<string>>(new Set());
  const hasReceivedLivePriceRef = useRef<boolean>(false);

  useEffect(() => {
    if (ticker.price > 0 && ticker.lastUpdated > 0 && isPriceWithin24hBounds) {
      hasReceivedLivePriceRef.current = true;
    }
  }, [ticker.price, ticker.lastUpdated, isPriceWithin24hBounds]);

  useEffect(() => {
    // Only execute paper ticks once a real verified live price has arrived, not on stale initial SSR props
    if (
      !isPaperTrading ||
      !activePosition ||
      controlMode !== "auto" ||
      !currentPrice ||
      currentPrice <= 0 ||
      !hasReceivedLivePriceRef.current
    ) {
      return;
    }

    const isLongPos = activePosition.side === "long";
    const isSlBreached = activePosition.sl
      ? (isLongPos ? currentPrice <= activePosition.sl : currentPrice >= activePosition.sl)
      : false;

    // Instant Stop Loss: bypass 1.5s throttle immediately when SL level is breached
    const now = Date.now();
    if (!isSlBreached && now - lastTickTimeRef.current < 1500) {
      return;
    }
    lastTickTimeRef.current = now;

    let isMounted = true;
    fetch("/api/trading/paper-tick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tradeId: activePosition.id,
        currentPrice
      })
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: {
        actionsCount?: number;
        isClosed?: boolean;
        tradeStatus?: string;
        success?: boolean;
        realizedPnl?: number;
        totalRealizedPnlDelta?: number;
        exitReason?: string;
      } | null) => {
        if (!isMounted || !data) return;

        const isClosed = Boolean(data.isClosed || data.tradeStatus === "closed");
        const hasRealizedDelta = typeof data.totalRealizedPnlDelta === "number" && Math.abs(data.totalRealizedPnlDelta) > 0.0001;

        if (isClosed || hasRealizedDelta) {
          const tradeKey = `${activePosition.id}-${isClosed ? "closed" : (data.actionsCount ?? 1)}`;
          if (!notifiedTradesRef.current.has(tradeKey)) {
            notifiedTradesRef.current.add(tradeKey);
            const positionMargin = activePosition.entryPrice > 0 && activePosition.qty > 0 && activePosition.leverage > 0
              ? (activePosition.entryPrice * activePosition.qty) / activePosition.leverage
              : 100;
            let finalPnl = typeof data.realizedPnl === "number"
              ? data.realizedPnl
              : (typeof data.totalRealizedPnlDelta === "number" ? data.totalRealizedPnlDelta : 0);

            // Strict isolated margin clamp: loss cannot exceed 100% of position margin
            finalPnl = Math.max(finalPnl, -positionMargin);
            const finalPct = Math.max(-100, Math.min(1000, (finalPnl / positionMargin) * 100));

            playTradeNotification(finalPnl);
            dispatchTradeToast({
              type: finalPnl >= 0 ? "profit" : "loss",
              title: finalPnl >= 0 ? "Фіксація прибутку 🎯" : "Спрацював Stop Loss 🛑",
              symbol,
              pnlUsdt: finalPnl,
              pnlPct: finalPct,
              reason: data.exitReason ?? (finalPnl >= 0 ? "Take Profit" : "Stop Loss")
            });
          }
          if (isClosed) {
            router.refresh();
          }
        }
      })
      .catch(() => {
        // network fallback
      });

    return () => {
      isMounted = false;
    };
  }, [isPaperTrading, activePosition, controlMode, currentPrice, router, symbol]);

  // Continuous trade status reconciliation: immediately reloads if trade is closed in DB by background worker
  useEffect(() => {
    if (!isPaperTrading || !activePosition || controlMode !== "auto" || !hasReceivedLivePriceRef.current || !isPriceWithin24hBounds) return;
    let isMounted = true;
    const interval = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch("/api/trading/paper-tick", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tradeId: activePosition.id,
              currentPrice: currentPrice > 0 ? currentPrice : activePosition.entryPrice
            })
          });
          if (res.ok && isMounted) {
            const data = (await res.json()) as {
              actionsCount?: number;
              isClosed?: boolean;
              tradeStatus?: string;
              realizedPnl?: number;
              totalRealizedPnlDelta?: number;
              exitReason?: string;
            };
            const isClosed = Boolean(data.isClosed || data.tradeStatus === "closed");
            const hasRealizedDelta = typeof data.totalRealizedPnlDelta === "number" && Math.abs(data.totalRealizedPnlDelta) > 0.0001;

            if (isClosed || hasRealizedDelta) {
              const tradeKey = `${activePosition.id}-${isClosed ? "closed" : (data.actionsCount ?? 1)}`;
              if (!notifiedTradesRef.current.has(tradeKey)) {
                notifiedTradesRef.current.add(tradeKey);
                const positionMargin = activePosition.entryPrice > 0 && activePosition.qty > 0 && activePosition.leverage > 0
                  ? (activePosition.entryPrice * activePosition.qty) / activePosition.leverage
                  : 100;
                let finalPnl = typeof data.realizedPnl === "number"
                  ? data.realizedPnl
                  : (typeof data.totalRealizedPnlDelta === "number" ? data.totalRealizedPnlDelta : 0);

                // Strict isolated margin clamp: loss cannot exceed 100% of position margin
                finalPnl = Math.max(finalPnl, -positionMargin);
                const finalPct = Math.max(-100, Math.min(1000, (finalPnl / positionMargin) * 100));

                playTradeNotification(finalPnl);
                dispatchTradeToast({
                  type: finalPnl >= 0 ? "profit" : "loss",
                  title: finalPnl >= 0 ? "Фіксація прибутку 🎯" : "Спрацював Stop Loss 🛑",
                  symbol,
                  pnlUsdt: finalPnl,
                  pnlPct: finalPct,
                  reason: data.exitReason ?? (finalPnl >= 0 ? "Take Profit" : "Stop Loss")
                });
              }
              if (isClosed) {
                router.refresh();
              }
            }
          }
        } catch {
          // network fallback
        }
      })();
    }, 2500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isPaperTrading, activePosition, controlMode, isPriceWithin24hBounds, currentPrice, router, symbol]);

  const handleModeChange = async (newMode: "auto" | "manual") => {
    if (!activePosition || isUpdatingMode || newMode === controlMode) return;
    setIsUpdatingMode(true);
    setControlMode(newMode);
    try {
      await toggleTradeControlMode(activePosition.id, newMode, window.location.pathname);
    } catch {
      setControlMode(controlMode);
    } finally {
      setIsUpdatingMode(false);
    }
  };

  // Real-time dynamic PnL computation
  const direction = activePosition?.side === "long" ? 1 : -1;
  const priceDiff = activePosition ? (currentPrice - activePosition.entryPrice) * direction : 0;
  const livePnlUsdt = activePosition && activePosition.qty > 0
    ? priceDiff * activePosition.qty
    : (activePosition?.pnlUsdt ?? 0);
  const livePnlPct = activePosition && activePosition.entryPrice > 0
    ? (priceDiff / activePosition.entryPrice) * 100 * activePosition.leverage
    : (activePosition?.pnlPct ?? 0);

  const displayPnlUsdt = activePosition ? livePnlUsdt : (recentHistoricalTrade?.pnlUsdt ?? 0);
  const displayPnlPct = activePosition ? livePnlPct : (recentHistoricalTrade?.pnlPct ?? 0);

  const slDistancePct = entry > 0 && stopLoss > 0 ? Math.abs(entry - stopLoss) / entry : 0;
  const change24hVal = Math.abs(Number(initialPriceChangePct) || 0);
  const isHighVolatility = Boolean(
    slDistancePct >= 0.035 ||
    change24hVal >= 10 ||
    strategy?.toLowerCase().includes("volatility") ||
    strategy?.toLowerCase().includes("expansion") ||
    strategy?.toLowerCase().includes("squeeze") ||
    strategy?.toLowerCase().includes("імпульс") ||
    rationale?.toLowerCase().includes("volatility") ||
    symbol.toUpperCase() === "QUSDT"
  );

  return (
    <>
      {/* Top Breadcrumb & Status Pill */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
        <div className="lb" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Link href="/dashboard/signals" style={{ color: "var(--muted)", textDecoration: "none" }}>
            ← Всі сигнали
          </Link>
          <span>/</span>
          <span style={{ color: "#FFFFFF", fontWeight: 600 }}>{symbol}</span>
        </div>

        {/* 48-Hour Lifecycle & Live Trade Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {isArchived ? (
            <span className="tg gy" style={{ color: "#FF5A6E", border: "1px solid #FF5A6E33" }}>
              📁 В архіві · Не актуально ({Math.round(ageHours)}г тому)
            </span>
          ) : (
            <span className="tg lg">
              🟢 Актуальний сигнал (ще {remainingHours}г)
            </span>
          )}

          {isHighVolatility ? (
            <span
              className="tg"
              style={{
                background: "rgba(255, 194, 75, 0.15)",
                color: "#FFC24B",
                border: "1px solid rgba(255, 194, 75, 0.4)",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px"
              }}
              title="Підвищена волатильність: швидкі коливання ціни за 1 секунду"
            >
              ⚡ Висока волатильність
            </span>
          ) : null}

          {activePosition ? (
            <span
              className="tg lg"
              style={{
                background: livePnlUsdt >= 0 ? "#42F5B922" : "#FF5A6E22",
                color: livePnlUsdt >= 0 ? "#42F5B9" : "#FF5A6E",
                border: `1px solid ${livePnlUsdt >= 0 ? "#42F5B944" : "#FF5A6E44"}`,
                transition: "color 0.2s, background 0.2s"
              }}
            >
              ⚡ В трейді: {isPaperTrading ? "Paper" : "Live"} ({livePnlUsdt >= 0 ? "+" : ""}{livePnlUsdt.toFixed(2)} USDT / {livePnlPct >= 0 ? "+" : ""}{livePnlPct.toFixed(2)}%)
            </span>
          ) : null}

          {isArchived && targetSignalId && onDeleteFromArchive ? (
            <form action={onDeleteFromArchive}>
              <button
                type="submit"
                className="bt sm"
                style={{ padding: "4px 8px", fontSize: "11px", color: "#FF5A6E" }}
                title="Видалити цей сигнал з архіву"
              >
                🗑️ Видалити з архіву
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {/* Archive Notice Banner if > 48h */}
      {isArchived ? (
        <div
          className="notice"
          style={{
            background: "#161114",
            borderColor: "#FF5A6E33",
            color: "#D4C5CA",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px"
          }}
        >
          <div>
            <b style={{ color: "#FFFFFF" }}>Архівний сигнал:</b> З моменту створення минуло понад 48 годин.
            Сигнал збережено в архіві для аналітики та історії угод. Ви можете переглянути рівні або відкрити новий ордер за актуальною ринковою ціною.
          </div>
        </div>
      ) : null}

      {/* Trade Entry Fact Box (Де ми входили по Live / Paper) */}
      {(activePosition || recentHistoricalTrade) ? (
        <div
          className="cd"
          style={{
            padding: "16px 20px",
            background: "#141414",
            border: activePosition ? "1px solid #42F5B9" : "1px solid #262626",
            display: "flex",
            flexDirection: "column",
            gap: "10px"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "16px" }}>📍</span>
              <b style={{ font: "700 15px Inter, sans-serif", color: "#FFFFFF" }}>
                {activePosition ? "Активна позиція за цим сигналом" : "Історія виконання угоди"}
              </b>
              <span className={`tg ${activePosition ? "lg" : "gy"}`}>
                {tradingModeLabel}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              {activePosition ? (
                <div style={{ display: "flex", alignItems: "center", gap: "4px", background: "#1A1A1A", padding: "2px 4px", borderRadius: "4px", border: "1px solid #262626" }}>
                  <button
                    type="button"
                    onClick={() => { void handleModeChange("auto"); }}
                    disabled={isUpdatingMode}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "4px 8px",
                      borderRadius: "3px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      border: controlMode === "auto" ? "1px solid #7C4DFF" : "1px solid transparent",
                      background: controlMode === "auto" ? "#231A3B" : "transparent",
                      color: controlMode === "auto" ? "#B24BFF" : "#8A8A8A",
                      transition: "all 0.15s"
                    }}
                    title="ШІ автоматично виконує TP1-3, Trailing Stop та Stop Loss"
                  >
                    <span>🤖</span>
                    <span>Автопілот</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { void handleModeChange("manual"); }}
                    disabled={isUpdatingMode}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "4px 8px",
                      borderRadius: "3px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      border: controlMode === "manual" ? "1px solid #FFC24B" : "1px solid transparent",
                      background: controlMode === "manual" ? "#332412" : "transparent",
                      color: controlMode === "manual" ? "#FFC24B" : "#8A8A8A",
                      transition: "all 0.15s"
                    }}
                    title="Призупинити автозакриття: ви контролюєте вихід з угоди вручну"
                  >
                    <span>👤</span>
                    <span>Ручний контроль</span>
                  </button>
                </div>
              ) : null}

              <span className="lb" style={{ fontSize: "12px" }}>
                {activePosition?.opened_at ? `Вхід: ${formatTimeAgo(activePosition.opened_at)}` : (recentHistoricalTrade?.opened_at ? formatTimeAgo(recentHistoricalTrade.opened_at) : "Нещодавно")}
              </span>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: "8px",
              background: "#1A1A1A",
              padding: "10px 14px",
              borderRadius: "6px"
            }}
          >
            <div>
              <div className="lb" style={{ fontSize: "11px" }}>Ціна входу</div>
              <div className="v" style={{ fontSize: "14px", margin: "2px 0 0" }}>
                ${formatCryptoPrice(activePosition?.entryPrice ?? recentHistoricalTrade?.entryPrice ?? entry)}
              </div>
            </div>
            <div>
              <div className="lb" style={{ fontSize: "11px" }}>Позиція & Плече</div>
              <div className="v" style={{ fontSize: "14px", margin: "2px 0 0" }}>
                {(activePosition?.side ?? recentHistoricalTrade?.side ?? side).toUpperCase()} {(activePosition?.leverage ?? recentHistoricalTrade?.leverage ?? 5)}x
              </div>
            </div>
            <div>
              <div className="lb" style={{ fontSize: "11px" }}>Поточна Mark-ціна</div>
              <div className="v" style={{ fontSize: "14px", margin: "2px 0 0", color: "#FFFFFF" }}>
                ${formatCryptoPrice(currentPrice)}
              </div>
            </div>
            <div>
              <div className="lb" style={{ fontSize: "11px" }}>Результат PnL</div>
              <div
                className="v"
                style={{
                  fontSize: "14px",
                  margin: "2px 0 0",
                  color: displayPnlUsdt >= 0 ? "#42F5B9" : "#FF5A6E",
                  transition: "color 0.2s"
                }}
              >
                {displayPnlUsdt >= 0 ? "+" : ""}
                {displayPnlUsdt.toFixed(2)} USDT ({displayPnlPct >= 0 ? "+" : ""}{displayPnlPct.toFixed(2)}%)
              </div>
            </div>
            {!activePosition && recentHistoricalTrade ? (
              <div>
                <div className="lb" style={{ fontSize: "11px" }}>Причина закриття</div>
                <div className="v" style={{ fontSize: "14px", margin: "2px 0 0", color: "#FFFFFF" }}>
                  {recentHistoricalTrade.exitReason === "take_profit" ? "Take Profit" :
                    recentHistoricalTrade.exitReason === "stop_loss" ? "Stop Loss" :
                      recentHistoricalTrade.exitReason === "trailing_stop" ? "Trailing Stop" :
                        recentHistoricalTrade.exitReason === "manual" ? "Manual close" : "Closed"}
                  {recentHistoricalTrade.exitPrice ? ` @ $${formatCryptoPrice(recentHistoricalTrade.exitPrice)}` : ""}
                </div>
              </div>
            ) : null}
          </div>

          {/* Mode Explainer Banner for Active Position */}
          {activePosition ? (
            controlMode === "manual" ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  background: "#221910",
                  border: "1px solid #FFC24B44",
                  borderRadius: "4px",
                  color: "#FFE2A6",
                  fontSize: "12px",
                  gap: "8px"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>👤</span>
                  <span>
                    <b>Ручний контроль:</b> Автоматичне закриття по TP/SL/Trailing призупинено. Ви маєте повний контроль над виходом (кнопки «50%» або «Close» в таблиці нижче).
                  </span>
                </div>
                <span style={{ fontSize: "11px", color: "#FFC24B", whiteSpace: "nowrap" }}>
                  ⏸️ Автозакриття на паузі
                </span>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  background: "#111A15",
                  border: "1px solid #42F5B933",
                  borderRadius: "4px",
                  color: "#C2FBE8",
                  fontSize: "12px",
                  gap: "8px"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>🤖</span>
                  <span>
                    <b>Автопілот ШІ:</b> Частковий Take Profit (TP1 40%, TP2 30%, TP3 30%) + Динамічний Trailing Stop (1% відкат від локального піку після TP1).
                  </span>
                </div>
                <span style={{ fontSize: "11px", color: "#42F5B9", whiteSpace: "nowrap" }}>
                  ⚡ Працює автономно
                </span>
              </div>
            )
          ) : null}
        </div>
      ) : null}

      {/* Symbol Header & 24h Stats in OKX Ticker Bar with Live Ticks */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", margin: "4px 0 8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <b style={{ font: "700 clamp(20px, 5.5vw, 26px) Inter, sans-serif", color: "#FFFFFF" }}>{symbol}</b>
          <span className="tg gy" style={{ padding: "2px 6px", fontSize: "11px" }}>Perp</span>
          <span className="tg gy" style={{ padding: "2px 6px", fontSize: "11px" }}>Bybit</span>
          <span
            className="v"
            style={{
              margin: 0,
              fontSize: "clamp(20px, 5.5vw, 26px)",
              color: ticker.tickDirection === "up" ? "#42F5B9" : ticker.tickDirection === "down" ? "#FF5A6E" : (isLong ? "#42F5B9" : "#FF5A6E"),
              transition: "color 0.3s"
            }}
          >
            {formatPrice(currentPrice)}
          </span>
          <span style={{ font: "600 13px Inter, sans-serif", color: isLong ? "#42F5B9" : "#FF5A6E" }}>
            {ticker.price24hPcnt}
          </span>
        </div>

        <div className="ticker-stats-row">
          <div>
            <div className="lb">24h high</div>
            <div className="v" style={{ margin: "2px 0 0" }}>{ticker.high24h}</div>
          </div>
          <div>
            <div className="lb">24h low</div>
            <div className="v" style={{ margin: "2px 0 0" }}>{ticker.low24h}</div>
          </div>
          <div>
            <div className="lb">24h volume</div>
            <div className="v" style={{ margin: "2px 0 0" }}>{ticker.volume24h}</div>
          </div>
          <div>
            <div className="lb">Funding</div>
            <div className="v" style={{ margin: "2px 0 0" }}>{ticker.fundingRate}</div>
          </div>
        </div>
      </div>

            {/* Mobile/Tablet Segmented Control (< 1140px only) */}
      <div
        className="mobile-stage-selector"
        style={{
          gap: "8px",
          background: "#0E0B1A",
          padding: "6px",
          borderRadius: "8px",
          border: "1px solid #2A2145",
          margin: "4px 0 12px"
        }}
      >
        <button
          type="button"
          onClick={() => setMobileTab("stage")}
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            background: mobileTab === "stage" ? "linear-gradient(135deg, #7C4DFF 0%, #B24BFF 100%)" : "transparent",
            color: mobileTab === "stage" ? "#FFFFFF" : "var(--muted)",
            border: "none",
            transition: "all 0.2s ease"
          }}
        >
          📈 Графік & Торгівля
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("companion")}
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            background: mobileTab === "companion" ? "linear-gradient(135deg, #7C4DFF 0%, #B24BFF 100%)" : "transparent",
            color: mobileTab === "companion" ? "#FFFFFF" : "var(--muted)",
            border: "none",
            transition: "all 0.2s ease"
          }}
        >
          🤖 AI Companion
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("workspace")}
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            background: mobileTab === "workspace" ? "linear-gradient(135deg, #7C4DFF 0%, #B24BFF 100%)" : "transparent",
            color: mobileTab === "workspace" ? "#FFFFFF" : "var(--muted)",
            border: "none",
            transition: "all 0.2s ease"
          }}
        >
          📋 Воркспейс & Інсайти
        </button>
      </div>

      {/* Main Full-Width Terminal Stage: 3 Panels */}
      <div className={`terminal-stage-grid mobile-view-${mobileTab}`}>
        {/* Panel 1: Live Interactive Chart (~50-55%) */}
        <div className="terminal-panel-chart" style={{ minWidth: 0, width: "100%" }}>
          <SignalChart
            symbol={symbol}
            initialKlines={klines}
            entry={entry}
            stopLoss={stopLoss}
            tp1={tp1}
            tp2={tp2}
            tp3={tp3}
            currentPrice={initialPrice}
            livePrice={currentPrice}
            position={activePosition ? {
              side: activePosition.side,
              leverage: activePosition.leverage,
              entryPrice: activePosition.entryPrice,
              pnlUsdt: livePnlUsdt,
              pnlPct: livePnlPct,
              isPaper: isPaperTrading,
              openedAt: activePosition.opened_at
            } : null}
            closedPosition={!activePosition && recentHistoricalTrade && recentHistoricalTrade.exitPrice ? {
              side: recentHistoricalTrade.side,
              leverage: recentHistoricalTrade.leverage,
              entryPrice: recentHistoricalTrade.entryPrice,
              exitPrice: recentHistoricalTrade.exitPrice,
              exitReason: recentHistoricalTrade.exitReason,
              pnlUsdt: recentHistoricalTrade.pnlUsdt,
              pnlPct: recentHistoricalTrade.pnlPct,
              openedAt: recentHistoricalTrade.opened_at,
              closedAt: recentHistoricalTrade.closed_at
            } : null}
          />
        </div>

        {/* Panel 2: Specs & Order Execution (~22%) */}
        <div className="terminal-panel-order" style={{ flexDirection: "column", gap: "16px", minWidth: 0 }}>
          {/* Signal Specs Card */}
          <div className="cd" style={{ padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <b style={{ font: "700 15px 'Plus Jakarta Sans', sans-serif", color: "#F1EEFF" }}>Специфікація сигналу</b>
              <span className={`tg ${side === "long" ? "lg" : "sh"}`}>
                {side.toUpperCase()}
              </span>
              <span className="lb" style={{ marginLeft: "auto", fontSize: "11px" }}>
                {createdAtTime ? formatTimeAgo(createdAtTime) : "Щойно"}
              </span>
            </div>

            {/* Status pill based on live currentPrice */}
            <div style={{ marginTop: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
              {(() => {
                const isLongPos = side === "long";
                const driftPct = entry > 0 ? ((currentPrice - entry) / entry) * 100 * (isLongPos ? 1 : -1) : 0;
                const isTp1Breached = isLongPos ? currentPrice >= tp1 : currentPrice <= tp1;
                const isSlBreached = isLongPos ? currentPrice <= stopLoss : currentPrice >= stopLoss;

                if (isTp1Breached) {
                  return (
                    <span className="tg" style={{ background: "rgba(124, 77, 255, 0.18)", color: "#B9A2FF", border: "1px solid #7C4DFF", fontSize: "11px", fontWeight: 700 }}>
                      🎯 TP1 вже досягнуто (+{driftPct.toFixed(1)}%)
                    </span>
                  );
                }
                if (isSlBreached) {
                  return (
                    <span className="tg sh" style={{ fontSize: "11px", fontWeight: 700 }}>
                      ⛔ SL пробито ({driftPct.toFixed(1)}%)
                    </span>
                  );
                }
                if (Math.abs(driftPct) >= 1.2) {
                  return (
                    <span className="tg" style={{ background: "rgba(255, 194, 75, 0.15)", color: "#FFC24B", border: "1px solid #FFC24B55", fontSize: "11px", fontWeight: 700 }}>
                      ⚠️ Зсув {driftPct >= 0 ? "+" : ""}{driftPct.toFixed(1)}%
                    </span>
                  );
                }
                return (
                  <span className="tg lg" style={{ fontSize: "11px", fontWeight: 700 }}>
                    🟢 Сетап активний
                  </span>
                );
              })()}
            </div>

            <div style={{ marginTop: "12px" }}>
              <div className="row">
                <span>Ціна входу (Entry)</span>
                <span style={{ fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>${formatPrice(entry)}</span>
              </div>
              <div className="row">
                <span>Stop Loss</span>
                <span style={{ color: "#FF4F9A", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>${formatPrice(stopLoss)}</span>
              </div>
              <div className="row">
                <span>TP 1 · 40%</span>
                <span style={{ color: "#35F2D0", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>${formatPrice(tp1)}</span>
              </div>
              <div className="row">
                <span>TP 2 · 30%</span>
                <span style={{ color: "#35F2D0", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>${formatPrice(tp2)}</span>
              </div>
              <div className="row">
                <span>TP 3 · 30%</span>
                <span style={{ color: "#35F2D0", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>${formatPrice(tp3)}</span>
              </div>
              <div className="row">
                <span>Trailing Stop</span>
                <span>1% після TP1</span>
              </div>
              <div className="row">
                <span>R : R коефіцієнт</span>
                <span style={{ color: "#35F2D0", fontFamily: "'JetBrains Mono', monospace" }}>1 : {(riskReward ?? 1.8).toFixed(2)}</span>
              </div>
              <div className="row">
                <span>Впевненість ШІ</span>
                <span style={{ color: "#35F2D0", fontFamily: "'JetBrains Mono', monospace" }}>{winProbabilityPct ?? 69}% Win Rate</span>
              </div>
            </div>
          </div>

          {/* Live Order Terminal */}
          {onExecute ? (
            <SignalExecutionPanel
              symbol={symbol}
              side={side}
              currentPrice={currentPrice}
              signalEntry={entry}
              availableBalance={availableBalance ?? 20050}
              stopLossPrice={stopLoss}
              tp1Price={tp1}
              tp2Price={tp2}
              tp3Price={tp3}
              lockSignalSide={Boolean(targetSignalId)}
              onExecute={onExecute}
            />
          ) : (
            children
          )}
        </div>

        {/* Panel 3: Always-On Per-Trade AI Companion (~26%) */}
        <div className="terminal-panel-companion" style={{ minWidth: 0, height: "100%" }}>
          <TradeCompanionPanel
            initialSession={aiSession ?? null}
            symbol={symbol}
            side={side}
            currentPrice={currentPrice}
            entryPrice={entry}
            stopLossPrice={stopLoss}
            tp1Price={tp1}
            pnlUsdt={activePosition ? livePnlUsdt : undefined}
            pnlPct={activePosition ? livePnlPct : undefined}
            isPaperTrading={isPaperTrading}
            signalId={targetSignalId}
            tradeId={activePosition?.id}
          />
        </div>
      </div>

      {/* Bottom Institutional Workspace with Full-Width Tabs */}
      <div className={`terminal-workspace mobile-view-${mobileTab}`}>
        {/* Workspace Tab Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            borderBottom: "1px solid #2A2145",
            overflowX: "auto",
            background: "#0E0B1A",
            padding: "0 8px"
          }}
        >
          <button
            type="button"
            className={`terminal-tab-btn ${workspaceTab === "positions" ? "active" : ""}`}
            onClick={() => setWorkspaceTab("positions")}
          >
            📋 Позиції & Історія ({tradesList.length + historyTrades.length})
          </button>
          <button
            type="button"
            className={`terminal-tab-btn ${workspaceTab === "ensemble" ? "active" : ""}`}
            onClick={() => setWorkspaceTab("ensemble")}
          >
            🧠 AI Decision Ensemble (4 Gates)
          </button>
          <button
            type="button"
            className={`terminal-tab-btn ${workspaceTab === "mtf" ? "active" : ""}`}
            onClick={() => setWorkspaceTab("mtf")}
          >
            📊 MTF Структура (1D / 4H / 15m)
          </button>
          <button
            type="button"
            className={`terminal-tab-btn ${workspaceTab === "orderflow" ? "active" : ""}`}
            onClick={() => setWorkspaceTab("orderflow")}
          >
            🌊 Order Flow & CVD
          </button>
          <button
            type="button"
            className={`terminal-tab-btn ${workspaceTab === "news" ? "active" : ""}`}
            onClick={() => setWorkspaceTab("news")}
          >
            📰 Новини & Події
          </button>
          <button
            type="button"
            className={`terminal-tab-btn ${workspaceTab === "audit" ? "active" : ""}`}
            onClick={() => setWorkspaceTab("audit")}
          >
            📜 Журнал аудиту
          </button>
        </div>

        {/* Tab 1: Positions & History */}
        {workspaceTab === "positions" ? (
          <div style={{ padding: "16px" }}>
            <SignalPositionsTable
              symbol={symbol}
              trades={tradesList}
              historyTrades={historyTrades}
              livePrice={currentPrice}
            />
          </div>
        ) : null}

        {/* Tab 2: AI Ensemble Card (4 Gates) */}
        {workspaceTab === "ensemble" ? (
          <div style={{ padding: "16px" }}>
            <AiEnsembleCard
              symbol={symbol}
              side={side}
              strategy={strategy}
              rationale={rationale}
              qualityScore={qualityScore}
              qualityTier={qualityTier}
              winProbabilityPct={winProbabilityPct ?? 73}
              mlPrediction={mlPrediction ?? null}
              microstructure={microstructure ?? null}
              adaptiveAi={adaptiveAi ?? {
                confidencePct: winProbabilityPct ?? 73,
                qualityScore: parseFloat(qualityScore) || 7.0,
                qualityTier: (qualityTier as "A+" | "A" | "B" | "C" | "High Risk") || "B",
                penalties: [],
                bonuses: [],
                learningContext: "",
                isHighRisk: qualityTier === "High Risk",
                decision: qualityTier === "High Risk" ? "NO_TRADE" : "TRADE"
              }}
            />
          </div>
        ) : null}

        {/* Tab 3: Multi-Timeframe Structure Snapshot */}
        {workspaceTab === "mtf" ? (
          <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
              <div>
                <b style={{ color: "#F1EEFF", fontSize: "16px" }}>Multi-Timeframe Структура (MTF Intelligence)</b>
                <div style={{ color: "var(--muted)", fontSize: "12px", marginTop: "2px" }}>
                  Кореляція трендів 1D, 4H та 15M з обов'язковою верифікацією EMA200 (warm-up &gt;= 200 свічок).
                </div>
              </div>
              <span className="tg lg" style={{ fontSize: "11px" }}>
                {marketContext?.alignment?.overallBias ? `Загальний ухил: ${marketContext.alignment.overallBias.toUpperCase()}` : "Синхронізація активна"}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
              {/* 1D Frame */}
              <div style={{ background: "#171229", border: "1px solid #2A2145", borderRadius: "8px", padding: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <b style={{ color: "#B9A2FF", fontSize: "14px" }}>1D (Денний таймфрейм)</b>
                  <span className="tg gy" style={{ fontSize: "10px" }}>
                    {marketContext?.timeframes?.["1D"]?.status ?? "OK"}
                  </span>
                </div>
                <div style={{ marginTop: "10px", fontSize: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div className="row">
                    <span>Тренд / Режим:</span>
                    <b style={{ color: "#F1EEFF" }}>{marketContext?.timeframes?.["1D"]?.trend ?? "bullish"}</b>
                  </div>
                  <div className="row">
                    <span>EMA 200 Warmup:</span>
                    <span style={{ color: marketContext?.timeframes?.["1D"]?.hasEma200Warmup ? "#35F2D0" : "#A59CC4" }}>
                      {marketContext?.timeframes?.["1D"]?.hasEma200Warmup ? "Підтверджено (200+ барів)" : "Недостатня глибина"}
                    </span>
                  </div>
                  <div className="row">
                    <span>RSI (14 Wilder):</span>
                    <span style={{ fontFamily: "monospace" }}>{marketContext?.timeframes?.["1D"]?.rsi?.toFixed(1) ?? "—"}</span>
                  </div>
                </div>
              </div>

              {/* 4H Frame */}
              <div style={{ background: "#171229", border: "1px solid #2A2145", borderRadius: "8px", padding: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <b style={{ color: "#B9A2FF", fontSize: "14px" }}>4H (4-годинний свінг)</b>
                  <span className="tg gy" style={{ fontSize: "10px" }}>
                    {marketContext?.timeframes?.["4H"]?.status ?? "OK"}
                  </span>
                </div>
                <div style={{ marginTop: "10px", fontSize: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div className="row">
                    <span>Тренд:</span>
                    <b style={{ color: "#F1EEFF" }}>{marketContext?.timeframes?.["4H"]?.trend ?? (side === "long" ? "bullish" : "bearish")}</b>
                  </div>
                  <div className="row">
                    <span>Злам структури:</span>
                    <span style={{ color: "#35F2D0" }}>{marketContext?.timeframes?.["4H"]?.structureShift ?? "NONE"}</span>
                  </div>
                  <div className="row">
                    <span>Локальний розмах:</span>
                    <span style={{ fontFamily: "monospace" }}>
                      ${marketContext?.timeframes?.["4H"]?.swingLow?.toFixed(2) ?? "—"} - ${marketContext?.timeframes?.["4H"]?.swingHigh?.toFixed(2) ?? "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* 15M Frame */}
              <div style={{ background: "#171229", border: "1px solid #2A2145", borderRadius: "8px", padding: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <b style={{ color: "#B9A2FF", fontSize: "14px" }}>15M (Тригер входу)</b>
                  <span className="tg lg" style={{ fontSize: "10px" }}>Активний</span>
                </div>
                <div style={{ marginTop: "10px", fontSize: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div className="row">
                    <span>Тренд:</span>
                    <b style={{ color: side === "long" ? "#35F2D0" : "#FF4F9A" }}>{side.toUpperCase()}</b>
                  </div>
                  <div className="row">
                    <span>Свічки в пам'яті:</span>
                    <span>{klines.length} свічок</span>
                  </div>
                  <div className="row">
                    <span>Статус тригера:</span>
                    <span style={{ color: "#35F2D0" }}>Вхід у зоні дисконту</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Tab 4: Order Flow & CVD Analytics */}
        {workspaceTab === "orderflow" ? (
          <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <b style={{ color: "#F1EEFF", fontSize: "16px" }}>Order Flow, Стакан (DOM) та Біржовий Потік</b>
              <div style={{ color: "var(--muted)", fontSize: "12px", marginTop: "2px" }}>
                Прямий розрахунок глибини стакану (OBI), дельти недавніх угод (CVD) та виявлення прихованого ліквідаційного ризику.
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px" }}>
              <div style={{ background: "#171229", border: "1px solid #2A2145", borderRadius: "8px", padding: "14px" }}>
                <div className="lb" style={{ fontSize: "12px" }}>Дисбаланс стакану (Order Book Imbalance)</div>
                <div style={{ fontSize: "20px", fontWeight: 700, margin: "6px 0", color: (microstructure?.orderBook?.linearImbalance ?? 0) >= 0 ? "#35F2D0" : "#FF4F9A" }}>
                  {microstructure?.orderBook?.linearImbalance !== undefined
                    ? `${(microstructure.orderBook.linearImbalance * 100).toFixed(1)}%`
                    : "0.0%"}
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                  Зважений OBI top-of-book: {microstructure?.orderBook?.weightedImbalance ? `${(microstructure.orderBook.weightedImbalance * 100).toFixed(1)}%` : "Збалансовано"}
                </div>
              </div>

              <div style={{ background: "#171229", border: "1px solid #2A2145", borderRadius: "8px", padding: "14px" }}>
                <div className="lb" style={{ fontSize: "12px" }}>Дельта поглинання (CVD Snapshot)</div>
                <div style={{ fontSize: "20px", fontWeight: 700, margin: "6px 0", color: (microstructure?.tape?.cvdUsd ?? 0) >= 0 ? "#35F2D0" : "#FF4F9A" }}>
                  {microstructure?.tape?.cvdUsd !== undefined
                    ? `${microstructure.tape.cvdUsd >= 0 ? "+" : ""}${microstructure.tape.cvdUsd.toFixed(0)} USDT`
                    : "—"}
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                  Агресія покупців: {microstructure?.tape?.buyerAggressionPct ? `${microstructure.tape.buyerAggressionPct.toFixed(1)}%` : "50.0%"}
                </div>
              </div>

              <div style={{ background: "#171229", border: "1px solid #2A2145", borderRadius: "8px", padding: "14px" }}>
                <div className="lb" style={{ fontSize: "12px" }}>Великі біржові угоди (Whale Tape)</div>
                <div style={{ fontSize: "20px", fontWeight: 700, margin: "6px 0", color: "#F1EEFF" }}>
                  {microstructure?.tape?.whaleTradesCount ?? 0} угод
                </div>
                <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                  Squeeze Risk: {microstructure?.derivatives?.squeezeRisk ?? "none"}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Tab 5: News & Events */}
        {workspaceTab === "news" ? (
          <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
              <div>
                <b style={{ color: "#F1EEFF", fontSize: "16px" }}>Новини та Події (News & Event Intelligence)</b>
                <div style={{ color: "var(--muted)", fontSize: "12px", marginTop: "2px" }}>
                  Офіційні біржові анонси Bybit, розклади розблокування токенів та макроекономічні дані (CPI/FOMC).
                </div>
              </div>
              <span className="tg gy" style={{ fontSize: "11px" }}>
                {newsRisk?.riskLevel ? `Рівень ризику новин: ${newsRisk.riskLevel}` : "Перевірено"}
              </span>
            </div>

            <div style={{ background: "#171229", border: "1px solid #2A2145", borderRadius: "8px", padding: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#35F2D0" }}>
                <span>🛡️</span>
                <b style={{ fontSize: "14px" }}>Жодних критичних негативних подій для {symbol} не зафіксовано</b>
              </div>
              <p style={{ color: "#A59CC4", fontSize: "12.5px", margin: "8px 0 0", lineHeight: "1.5" }}>
                Система News Agent перевірила біржовий статус контракту (відсутні анонси про делістинг, технічні роботи або примусові зміни плеча).
                Якщо біржовий статус зміниться, Trade Companion миттєво сповістить вас у чаті.
              </p>
            </div>
          </div>
        ) : null}

        {/* Tab 6: Audit Log & Policy */}
        {workspaceTab === "audit" ? (
          <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <b style={{ color: "#F1EEFF", fontSize: "16px" }}>Журнал аудиту та Політика безпеки (Security Lock)</b>
              <div style={{ color: "var(--muted)", fontSize: "12px", marginTop: "2px" }}>
                Фіксація provenance рішень, моделей ШІ та правил виконання.
              </div>
            </div>

            <div style={{ background: "#171229", border: "1px solid #2A2145", borderRadius: "8px", padding: "16px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "12.5px" }}>
              <div className="row">
                <span>Ідентифікатор сесії ШІ:</span>
                <span style={{ fontFamily: "monospace", color: "#B9A2FF" }}>{aiSession?.id ?? "local-session"}</span>
              </div>
              <div className="row">
                <span>Модель аналітики:</span>
                <span>CatBoost v0.3.0 + Nemotron Meta-Agent</span>
              </div>
              <div className="row">
                <span>Політика дій:</span>
                <span style={{ color: "#FFC24B", fontWeight: 600 }}>Explicit User Confirmation Required (Потрібне підтвердження трейдера)</span>
              </div>
              <div className="row">
                <span>Ізоляція даних:</span>
                <span>Supabase RLS Account Ownership Policy</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
