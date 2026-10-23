"use client";

import Link from "next/link";
import type { Kline } from "@crypto-bot/shared";
import { formatPrice, formatCryptoPrice } from "../../../../lib/format";
import { formatTimeAgo } from "../../../../lib/date";
import { useLiveTicker } from "../../../../hooks/use-live-ticker";
import { SignalChart } from "./signal-chart";
import { SignalPositionsTable, type SignalTradeItem } from "./signal-positions-table";

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
  onDeleteFromArchive,
  children
}: SignalLiveStageProps) {
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

  const currentPrice = ticker.price > 0 ? ticker.price : initialPrice;
  const isLong = side === "long";

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

            <span className="lb" style={{ fontSize: "12px" }}>
              {activePosition?.opened_at ? `Вхід: ${formatTimeAgo(activePosition.opened_at)}` : (recentHistoricalTrade?.opened_at ? formatTimeAgo(recentHistoricalTrade.opened_at) : "Нещодавно")}
            </span>
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
          </div>
        </div>
      ) : null}

      {/* Symbol Header & 24h Stats in OKX Ticker Bar with Live Ticks */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap", margin: "4px 0 8px" }}>
        <b style={{ font: "700 26px Inter, sans-serif", color: "#FFFFFF" }}>{symbol}</b>
        <span className="tg gy">Perp</span>
        <span className="tg gy">Bybit</span>
        <span
          className="v"
          style={{
            margin: 0,
            fontSize: "28px",
            color: ticker.tickDirection === "up" ? "#42F5B9" : ticker.tickDirection === "down" ? "#FF5A6E" : (isLong ? "#42F5B9" : "#FF5A6E"),
            transition: "color 0.3s"
          }}
        >
          {formatPrice(currentPrice)}
        </span>
        <span style={{ font: "600 14px Inter, sans-serif", color: isLong ? "#42F5B9" : "#FF5A6E" }}>
          {ticker.price24hPcnt}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: "24px", flexWrap: "wrap" }}>
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

      {/* Main Layout: 840px Left Stage + 360px Right Terminal */}
      <div className="signal-layout">
        {/* Left Column (840px): Chart + Positions Table + AI Context */}
        <div className="signal-stage">
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
              isPaper: isPaperTrading
            } : null}
          />

          <SignalPositionsTable
            symbol={symbol}
            trades={tradesList}
            historyTrades={historyTrades}
            livePrice={currentPrice}
          />

          {/* AI Smart Money & Nemotron Setup Card */}
          <div className="cd" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <b style={{ font: "700 15px Inter, sans-serif", color: "#FFFFFF" }}>Аналіз сетапу від Nemotron AI</b>
                <span className="tg gy" style={{ color: "#F5C451" }}>
                  ★ {qualityScore}/10 {qualityTier}
                </span>
              </div>
              <span className="lb" style={{ fontSize: "12px" }}>
                Vexqora Memory: 73.0% Win Rate (37 збігів)
              </span>
            </div>

            <div style={{ font: "600 14px Inter, sans-serif", color: "#FFFFFF" }}>
              {strategy}
            </div>

            <div style={{ font: "400 13px Inter, sans-serif", color: "#9A9A9A", lineHeight: 1.5 }}>
              {rationale}
            </div>
          </div>
        </div>

        {/* Right Column (360px): Signal Specs + Execution Panel */}
        {children}
      </div>
    </>
  );
}
