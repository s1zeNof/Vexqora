/**
 * Global Market Regime Monitor (P0-10)
 *
 * Tracks BTC and ETH multi-timeframe regime (1D, 4H, 1H, 15M),
 * calculates alt-BTC rolling correlation, beta, relative strength,
 * and emits market regime events:
 * - BTC_REGIME_CHANGE
 * - BTC_IMPULSE
 * - ALT_BTC_DECOUPLING
 * - NEWS_SHOCK
 * - HTF_STRUCTURE_CHANGE
 */

import type { Kline } from "@crypto-bot/shared";

export type TrendRegime = "bullish_trend" | "bearish_trend" | "range_consolidation" | "regime_shift" | "unknown";
export type RiskEnvironment = "risk_on" | "risk_off" | "neutral" | "decoupling";

export interface TimeframeRegime {
  timeframe: "1D" | "4H" | "1H" | "15M";
  trend: TrendRegime;
  ema20: number | null;
  ema50: number | null;
  rsi: number | null;
  asOfMs: number;
}

export interface AssetRegimeSnapshot {
  symbol: "BTCUSDT" | "ETHUSDT";
  dominantTrend: TrendRegime;
  timeframes: Record<string, TimeframeRegime>;
  asOfMs: number;
  status: "OK" | "STALE" | "UNAVAILABLE";
}

export interface GlobalMarketRegime {
  status: "OK" | "STALE" | "UNAVAILABLE";
  asOfMs: number;
  receivedAtMs: number;
  btc: AssetRegimeSnapshot;
  eth: AssetRegimeSnapshot;
  riskEnvironment: RiskEnvironment;
  marketBreadthPct: number | null; // % of altcoins trading above 4H EMA50
  source: string;
  qualityWarnings: string[];
}

export interface BtcDependencyResult {
  symbol: string;
  status: "OK" | "INSUFFICIENT_DATA" | "UNAVAILABLE";
  rollingCorrelation1h: number | null;
  rollingCorrelation4h: number | null;
  betaToBtc: number | null;
  relativeStrengthPct: number | null; // Alt 24h change minus BTC 24h change
  leadLag: "leading_btc" | "lagging_btc" | "synchronized" | "decoupled";
  sampleBarsUsed: number;
  asOfMs: number;
}

export interface MarketRegimeEvent {
  eventId: string;
  type: "BTC_REGIME_CHANGE" | "BTC_IMPULSE" | "ALT_BTC_DECOUPLING" | "NEWS_SHOCK" | "HTF_STRUCTURE_CHANGE";
  symbol?: string;
  sourceRegime?: TrendRegime;
  targetRegime?: TrendRegime;
  severity: "INFO" | "WARNING" | "CRITICAL";
  timestampMs: number;
  description: string;
}

/**
 * Calculates exponential moving average for closed candles.
 */
function calculateEma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i]! * k + ema * (1 - k);
  }
  return Number(ema.toFixed(4));
}

/**
 * Calculates 14-period RSI.
 */
function calculateRsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change >= 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? -change : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - (100 / (1 + rs))).toFixed(2));
}

/**
 * Classifies regime from closed candles.
 */
export function classifyKlinesRegime(
  klines: Kline[],
  timeframe: "1D" | "4H" | "1H" | "15M"
): TimeframeRegime {
  const asOfMs = klines.length > 0 ? klines[klines.length - 1]!.time : Date.now();
  if (klines.length < 20) {
    return {
      timeframe,
      trend: "unknown",
      ema20: null,
      ema50: null,
      rsi: null,
      asOfMs
    };
  }

  const closes = klines.map(k => k.close);
  const ema20 = calculateEma(closes, 20);
  const ema50 = calculateEma(closes, Math.min(50, closes.length));
  const rsi = calculateRsi(closes, 14);
  const lastClose = closes[closes.length - 1]!;

  let trend: TrendRegime = "range_consolidation";
  if (ema20 !== null && ema50 !== null) {
    if (lastClose > ema20 && ema20 > ema50 && (rsi === null || rsi > 52)) {
      trend = "bullish_trend";
    } else if (lastClose < ema20 && ema20 < ema50 && (rsi === null || rsi < 48)) {
      trend = "bearish_trend";
    } else if (Math.abs(lastClose - ema20) / ema20 > 0.05) {
      trend = "regime_shift";
    }
  }

  return {
    timeframe,
    trend,
    ema20,
    ema50,
    rsi,
    asOfMs
  };
}

/**
 * Computes Pearson correlation and beta of altcoin returns against BTC returns.
 */
export function calculateBtcDependency(
  symbol: string,
  altKlines: Kline[],
  btcKlines: Kline[]
): BtcDependencyResult {
  const asOfMs = Date.now();
  if (altKlines.length < 20 || btcKlines.length < 20) {
    return {
      symbol,
      status: "INSUFFICIENT_DATA",
      rollingCorrelation1h: null,
      rollingCorrelation4h: null,
      betaToBtc: null,
      relativeStrengthPct: null,
      leadLag: "synchronized",
      sampleBarsUsed: Math.min(altKlines.length, btcKlines.length),
      asOfMs
    };
  }

  // Align timestamps
  const btcMap = new Map<number, number>();
  for (const k of btcKlines) {
    btcMap.set(k.time, k.close);
  }

  const altReturns: number[] = [];
  const btcReturns: number[] = [];

  for (let i = 1; i < altKlines.length; i++) {
    const prevAlt = altKlines[i - 1]!;
    const currAlt = altKlines[i]!;
    const prevBtc = btcMap.get(prevAlt.time);
    const currBtc = btcMap.get(currAlt.time);

    if (prevBtc && currBtc) {
      altReturns.push((currAlt.close - prevAlt.close) / prevAlt.close);
      btcReturns.push((currBtc - prevBtc) / prevBtc);
    }
  }

  if (altReturns.length < 15) {
    return {
      symbol,
      status: "INSUFFICIENT_DATA",
      rollingCorrelation1h: null,
      rollingCorrelation4h: null,
      betaToBtc: null,
      relativeStrengthPct: null,
      leadLag: "synchronized",
      sampleBarsUsed: altReturns.length,
      asOfMs
    };
  }

  // Mean & Covariance
  const n = altReturns.length;
  const meanAlt = altReturns.reduce((s, v) => s + v, 0) / n;
  const meanBtc = btcReturns.reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let varAlt = 0;
  let varBtc = 0;

  for (let i = 0; i < n; i++) {
    const dAlt = altReturns[i]! - meanAlt;
    const dBtc = btcReturns[i]! - meanBtc;
    cov += dAlt * dBtc;
    varAlt += dAlt * dAlt;
    varBtc += dBtc * dBtc;
  }

  const stdAlt = Math.sqrt(varAlt);
  const stdBtc = Math.sqrt(varBtc);
  const correlation = (stdAlt > 0 && stdBtc > 0) ? Number((cov / (stdAlt * stdBtc)).toFixed(3)) : 0;
  const beta = varBtc > 0 ? Number((cov / varBtc).toFixed(3)) : 1.0;

  // Relative strength: last 24 bars (~6h on 15m or 24h on 1h)
  const firstAlt = altKlines[0]!.close;
  const lastAlt = altKlines[altKlines.length - 1]!.close;
  const altPerf = ((lastAlt - firstAlt) / firstAlt) * 100;

  const firstBtc = btcKlines[0]!.close;
  const lastBtc = btcKlines[btcKlines.length - 1]!.close;
  const btcPerf = ((lastBtc - firstBtc) / firstBtc) * 100;
  const relativeStrengthPct = Number((altPerf - btcPerf).toFixed(2));

  let leadLag: "leading_btc" | "lagging_btc" | "synchronized" | "decoupled" = "synchronized";
  if (Math.abs(correlation) < 0.3) {
    leadLag = "decoupled";
  } else if (relativeStrengthPct > 3.0 && altReturns[altReturns.length - 1]! > 0) {
    leadLag = "leading_btc";
  } else if (relativeStrengthPct < -3.0 && btcReturns[btcReturns.length - 1]! > 0) {
    leadLag = "lagging_btc";
  }

  return {
    symbol,
    status: "OK",
    rollingCorrelation1h: correlation,
    rollingCorrelation4h: correlation,
    betaToBtc: beta,
    relativeStrengthPct,
    leadLag,
    sampleBarsUsed: n,
    asOfMs
  };
}

/**
 * Checks if a BTC regime event invalidates or weakens an altcoin trade thesis.
 */
export function evaluateBtcImpactOnTrade(params: {
  altSide: "long" | "short";
  altSymbol: string;
  btcRegime: TrendRegime;
  btcDependency: BtcDependencyResult;
}): {
  impact: "ALIGNED" | "CONTRADICTION" | "NEUTRAL" | "HIGH_RISK";
  reason: string;
  requiresReassessment: boolean;
} {
  const isHighBeta = (params.btcDependency.betaToBtc ?? 1.0) >= 0.8;
  const isDecoupled = params.btcDependency.leadLag === "decoupled";

  if (isDecoupled) {
    return {
      impact: "NEUTRAL",
      reason: `${params.altSymbol} рухається незалежно від BTC (кореляція < 0.3, статус: decoupled). Режим BTC не є блокуючим.`,
      requiresReassessment: false
    };
  }

  if (params.altSide === "long" && params.btcRegime === "bearish_trend") {
    return {
      impact: isHighBeta ? "HIGH_RISK" : "CONTRADICTION",
      reason: `BTC перейшов у спадний (BEARISH) режим. Для ${params.altSymbol} (Beta: ${params.btcDependency.betaToBtc ?? 1.0}) LONG несе підвищений ризик дампу вслід за біткоїном.`,
      requiresReassessment: true
    };
  }

  if (params.altSide === "short" && params.btcRegime === "bullish_trend") {
    return {
      impact: isHighBeta ? "HIGH_RISK" : "CONTRADICTION",
      reason: `BTC знаходиться у висхідному (BULLISH) тренді. SHORT по ${params.altSymbol} має суперечність із макро-ринковим моментумом.`,
      requiresReassessment: true
    };
  }

  if (params.altSide === "long" && params.btcRegime === "bullish_trend") {
    return {
      impact: "ALIGNED",
      reason: `Режим BTC висхідний (BULLISH), що підтримує LONG по ${params.altSymbol}.`,
      requiresReassessment: false
    };
  }

  return {
    impact: "NEUTRAL",
    reason: `BTC у стані консолідації/діапазону (${params.btcRegime}). Ризик-середовище нейтральне.`,
    requiresReassessment: false
  };
}
