import type { Kline } from "@crypto-bot/shared";
import { calculateEMA, calculateRSI, calculateATR } from "./feature-registry";

export type SupportedTimeframe = "1D" | "4H" | "1H" | "15M" | "5M" | "1M";

export type TrendDirection = "bullish" | "bearish" | "ranging" | "unknown";

export type MarketRegime =
  | "trending_bullish"
  | "trending_bearish"
  | "range_bound"
  | "transition"
  | "high_volatility"
  | "insufficient_data";

export interface TimeframeStructure {
  timeframe: SupportedTimeframe;
  status: "OK" | "INSUFFICIENT_DATA" | "STALE";
  barsCount: number;
  trend: TrendDirection;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  hasEma200Warmup: boolean;
  rsi: number | null;
  atr: number | null;
  swingHigh: number | null;
  swingLow: number | null;
  structureShift: "BOS" | "CHOCH" | "NONE" | null;
  lastClose: number | null;
  asOfMs: number;
}

export interface MTFAlignment {
  isAligned: boolean;
  macroBias: TrendDirection;
  intradayBias: TrendDirection;
  overallBias: "long" | "short" | "neutral";
  conflicts: string[];
  confidenceScore: number; // 0..100
}

export interface MarketContextSnapshot {
  symbol: string;
  asOfMs: number;
  regime: MarketRegime;
  timeframes: Record<SupportedTimeframe, TimeframeStructure>;
  alignment: MTFAlignment;
  dataQuality: {
    missingTimeframes: SupportedTimeframe[];
    usableTimeframes: SupportedTimeframe[];
    hasMacroData: boolean;
    allCandlesClosed: boolean;
  };
}

/**
 * Analyzes a single timeframe's klines objectively.
 * Strictly enforces warm-up buffers: EMA200 requires >= 200 bars.
 */
export function analyzeTimeframeStructure(
  timeframe: SupportedTimeframe,
  klines: Kline[],
  asOfMs: number = Date.now()
): TimeframeStructure {
  if (!klines || klines.length < 5) {
    return {
      timeframe,
      status: "INSUFFICIENT_DATA",
      barsCount: klines?.length ?? 0,
      trend: "unknown",
      ema20: null,
      ema50: null,
      ema200: null,
      hasEma200Warmup: false,
      rsi: null,
      atr: null,
      swingHigh: null,
      swingLow: null,
      structureShift: null,
      lastClose: null,
      asOfMs
    };
  }

  const closes = klines.map((k) => k.close);
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  const n = closes.length;
  const lastClose = closes[n - 1] ?? null;

  // Indicators with Wilder's and EMA rules
  const ema20Arr = calculateEMA(closes, 20);
  const ema50Arr = calculateEMA(closes, 50);
  const ema20 = n >= 20 ? (ema20Arr[n - 1] ?? null) : null;
  const ema50 = n >= 50 ? (ema50Arr[n - 1] ?? null) : null;

  const hasEma200Warmup = n >= 200;
  let ema200: number | null = null;
  if (hasEma200Warmup) {
    const ema200Arr = calculateEMA(closes, 200);
    ema200 = ema200Arr[n - 1] ?? null;
  }

  const rsiArr = calculateRSI(closes, 14);
  const rsi = n >= 15 ? (rsiArr[n - 1] ?? null) : null;

  const atrArr = calculateATR(highs, lows, closes, 14);
  const atr = n >= 15 ? (atrArr[n - 1] ?? null) : null;

  // Swings across previous confirmed bars (excluding the bar being evaluated for breakout)
  // Ensures lastClose > swingHigh is mathematically valid for real OHLC where close <= high
  const lookback = Math.min(25, n - 1);
  let swingHigh: number;
  let swingLow: number;

  if (n >= 3 && lookback >= 2) {
    const priorHighs = highs.slice(n - 1 - lookback, n - 1);
    const priorLows = lows.slice(n - 1 - lookback, n - 1);
    swingHigh = Math.max(...priorHighs);
    swingLow = Math.min(...priorLows);
  } else {
    swingHigh = Math.max(...highs);
    swingLow = Math.min(...lows);
  }

  // Objective Trend Determination
  let trend: TrendDirection = "unknown";
  if (lastClose !== null && ema20 !== null && ema50 !== null) {
    if (lastClose > ema20 && ema20 > ema50) {
      trend = "bullish";
    } else if (lastClose < ema20 && ema20 < ema50) {
      trend = "bearish";
    } else {
      trend = "ranging";
    }
  } else if (lastClose !== null && ema20 !== null) {
    trend = lastClose > ema20 ? "bullish" : lastClose < ema20 ? "bearish" : "ranging";
  }

  // Structure Shift (BOS/CHOCH)
  let structureShift: "BOS" | "CHOCH" | "NONE" | null = "NONE";
  if (n >= 4 && lastClose !== null && swingHigh > 0 && swingLow > 0) {
    const prevClose = closes[n - 2] ?? lastClose;
    if (lastClose > swingHigh && prevClose <= swingHigh) {
      structureShift = trend === "bearish" ? "CHOCH" : "BOS";
    } else if (lastClose < swingLow && prevClose >= swingLow) {
      structureShift = trend === "bullish" ? "CHOCH" : "BOS";
    }
  }

  return {
    timeframe,
    status: "OK",
    barsCount: n,
    trend,
    ema20,
    ema50,
    ema200,
    hasEma200Warmup,
    rsi,
    atr,
    swingHigh,
    swingLow,
    structureShift,
    lastClose,
    asOfMs
  };
}

/**
 * Builds a unified canonical Multi-Timeframe (MTF) MarketContextSnapshot.
 * Explicitly surfaces conflicts, missing timeframes, and objective regime classification.
 */
export function buildMarketContextSnapshot(params: {
  symbol: string;
  timeframeKlines: Partial<Record<SupportedTimeframe, Kline[]>>;
  asOfMs?: number;
}): MarketContextSnapshot {
  const symbol = params.symbol.toUpperCase();
  const asOfMs = params.asOfMs ?? Date.now();
  const allTfs: SupportedTimeframe[] = ["1D", "4H", "1H", "15M", "5M", "1M"];

  const structures: Record<SupportedTimeframe, TimeframeStructure> = {} as Record<
    SupportedTimeframe,
    TimeframeStructure
  >;

  const missing: SupportedTimeframe[] = [];
  const usable: SupportedTimeframe[] = [];

  for (const tf of allTfs) {
    const klines = params.timeframeKlines[tf];
    if (!klines || klines.length === 0) {
      missing.push(tf);
      structures[tf] = {
        timeframe: tf,
        status: "INSUFFICIENT_DATA",
        barsCount: 0,
        trend: "unknown",
        ema20: null,
        ema50: null,
        ema200: null,
        hasEma200Warmup: false,
        rsi: null,
        atr: null,
        swingHigh: null,
        swingLow: null,
        structureShift: null,
        lastClose: null,
        asOfMs
      };
    } else {
      const s = analyzeTimeframeStructure(tf, klines, asOfMs);
      structures[tf] = s;
      if (s.status === "OK") usable.push(tf);
    }
  }

  // Macro bias from 1D and 4H
  const s1D = structures["1D"];
  const s4H = structures["4H"];
  let macroBias: TrendDirection = "unknown";
  if (s1D.status === "OK" && s4H.status === "OK") {
    if (s1D.trend === s4H.trend && s1D.trend !== "unknown") {
      macroBias = s1D.trend;
    } else if (s4H.trend !== "unknown") {
      macroBias = s4H.trend;
    } else {
      macroBias = s1D.trend;
    }
  } else if (s4H.status === "OK") {
    macroBias = s4H.trend;
  } else if (s1D.status === "OK") {
    macroBias = s1D.trend;
  }

  // Intraday bias from 1H, 15M, 5M
  const s1H = structures["1H"];
  const s15M = structures["15M"];
  const s5M = structures["5M"];

  const intradayTrends = [s1H, s15M, s5M]
    .filter((s) => s.status === "OK")
    .map((s) => s.trend)
    .filter((t) => t !== "unknown");

  let intradayBias: TrendDirection = "unknown";
  const bullCount = intradayTrends.filter((t) => t === "bullish").length;
  const bearCount = intradayTrends.filter((t) => t === "bearish").length;
  if (bullCount > bearCount) {
    intradayBias = "bullish";
  } else if (bearCount > bullCount) {
    intradayBias = "bearish";
  } else if (intradayTrends.length > 0) {
    intradayBias = "ranging";
  }

  // Alignment and conflict detection
  const conflicts: string[] = [];
  if (macroBias !== "unknown" && intradayBias !== "unknown" && macroBias !== intradayBias) {
    conflicts.push(
      `Macro trend (${macroBias.toUpperCase()}) conflicts with intraday bias (${intradayBias.toUpperCase()})`
    );
  }

  if (s15M.status === "OK" && s5M.status === "OK" && s15M.trend !== s5M.trend && s15M.trend !== "unknown") {
    conflicts.push(`15m trend (${s15M.trend}) disagrees with 5m trigger (${s5M.trend})`);
  }

  const isAligned = conflicts.length === 0 && macroBias !== "unknown" && macroBias === intradayBias;
  const overallBias = isAligned
    ? macroBias === "bullish"
      ? "long"
      : macroBias === "bearish"
      ? "short"
      : "neutral"
    : intradayBias === "bullish" && conflicts.length === 0
    ? "long"
    : intradayBias === "bearish" && conflicts.length === 0
    ? "short"
    : "neutral";

  let confidenceScore = 50;
  if (isAligned) confidenceScore = 85;
  else if (conflicts.length === 0 && usable.length >= 2) confidenceScore = 68;
  else if (conflicts.length > 0) confidenceScore = Math.max(25, 55 - conflicts.length * 15);

  // Overall Regime
  let regime: MarketRegime = "range_bound";
  if (usable.length === 0) {
    regime = "insufficient_data";
  } else if (isAligned && macroBias === "bullish") {
    regime = "trending_bullish";
  } else if (isAligned && macroBias === "bearish") {
    regime = "trending_bearish";
  } else if (conflicts.length > 0) {
    regime = "transition";
  }

  return {
    symbol,
    asOfMs,
    regime,
    timeframes: structures,
    alignment: {
      isAligned,
      macroBias,
      intradayBias,
      overallBias,
      conflicts,
      confidenceScore
    },
    dataQuality: {
      missingTimeframes: missing,
      usableTimeframes: usable,
      hasMacroData: s1D.status === "OK" || s4H.status === "OK",
      allCandlesClosed: usable.length >= 3 && missing.length === 0
    }
  };
}
