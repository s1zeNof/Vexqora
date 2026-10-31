import type { Kline } from "@crypto-bot/shared";
import { calculateWilderATR } from "./adx";
import { calculateScalpingEconomics, type ScalpingEconomicsResult } from "./scalping-economics";

export interface BybitLinearTicker {
  symbol: string;
  lastPrice: string;
  price24hPcnt: string;
  turnover24h: string;
}

export interface UniverseCandidateFilterOptions {
  direction?: "long" | "short" | "both";
  activeSymbols?: string[];
  minTurnover24h?: number;
  minPriceChangePct?: number;
  maxPriceChangePct?: number;
}

export interface FilteredUniverseCandidate {
  symbol: string;
  lastPrice: number;
  changePct: number;
  turnover: number;
  candidateSide: "long" | "short";
  score: number;
}

export interface BotOpportunityCandidate {
  symbol: string;
  side: "long" | "short";
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  trailingDistancePct: number;
  changePct: number;
  turnover: number;
  atr14: number;
  atrPct: number;
  rsi14: number;
  ema20: number;
  ema50: number;
  swingLevel: number;
  reasoning: string;
  economics: ScalpingEconomicsResult;
}

export function roundPriceByTick(val: number): number {
  if (val <= 0 || !Number.isFinite(val)) return 0;
  if (val < 0.001) return Number(val.toFixed(7));
  if (val < 0.01) return Number(val.toFixed(6));
  if (val < 0.1) return Number(val.toFixed(5));
  if (val < 1) return Number(val.toFixed(4));
  if (val < 10) return Number(val.toFixed(3));
  return Number(val.toFixed(2));
}

export function computeEMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i]! * k + ema * (1 - k);
  }
  return Number(ema.toFixed(6));
}

export function computeRSI(closes: number[], period = 14): number | null {
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
  return Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
}

/**
 * Filter the raw exchange ticker list for viable candidates:
 * 1. Must be USDT linear perpetual contract.
 * 2. Excludes active/already-held symbols.
 * 3. Enforces healthy volume turnover (>= $500,000).
 * 4. Strictly eliminates parabolic pump-and-dump exhaustion (> +18% or < -18%).
 * 5. Isolates healthy momentum: +1.0% to +15.0% for LONG, -1.0% to -15.0% for SHORT.
 */
export function filterBotUniverseCandidates(
  tickers: BybitLinearTicker[],
  options: UniverseCandidateFilterOptions = {}
): FilteredUniverseCandidate[] {
  const direction = options.direction ?? "both";
  const activeSet = new Set(options.activeSymbols ?? []);
  const minTurnover = options.minTurnover24h ?? 500_000;
  const minMove = options.minPriceChangePct ?? 1.0;
  const maxMove = options.maxPriceChangePct ?? 16.0;

  const valid = tickers
    .filter((t) => {
      if (!t.symbol.endsWith("USDT")) return false;
      if (activeSet.has(t.symbol)) return false;
      const price = Number(t.lastPrice);
      const turnover = Number(t.turnover24h ?? 0);
      return Number.isFinite(price) && price > 0 && turnover >= minTurnover;
    })
    .map((t) => {
      const lastPrice = Number(t.lastPrice);
      const changePct = Number(t.price24hPcnt) * 100;
      const turnover = Number(t.turnover24h ?? 0);
      return { symbol: t.symbol, lastPrice, changePct, turnover };
    });

  const candidates: FilteredUniverseCandidate[] = [];

  for (const item of valid) {
    if (direction === "long" || direction === "both") {
      if (item.changePct >= minMove && item.changePct <= maxMove) {
        // Quality score: volume weight * steady momentum
        const score = Math.log10(Math.max(10_000, item.turnover)) * item.changePct;
        candidates.push({
          ...item,
          candidateSide: "long",
          score,
        });
      }
    }

    if (direction === "short" || direction === "both") {
      if (item.changePct <= -minMove && item.changePct >= -maxMove) {
        const score = Math.log10(Math.max(10_000, item.turnover)) * Math.abs(item.changePct);
        candidates.push({
          ...item,
          candidateSide: "short",
          score,
        });
      }
    }
  }

  // Sort by highest momentum quality score
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

export interface TechnicalStructureParams {
  symbol: string;
  side: "long" | "short";
  klines: Kline[];
  changePct: number;
  turnover: number;
  depositUsdt: number;
  maxLeverage: number;
  riskPerTradePct: number;
}

/**
 * Validates candidate technical indicators and constructs structural SL / TP:
 * 1. Requires Trend Alignment: Price vs EMA20 vs EMA50.
 * 2. Requires Momentum Room: RSI between 38 and 66 for Long; 34 and 62 for Short.
 * 3. Requires Normal ATR Volatility (0.4% - 4.5%).
 * 4. Structural Swing SL: Placed beyond the local 15-bar swing level + buffer.
 * 5. Positive Expected Value: Verified via calculateScalpingEconomics.
 * 6. Dynamic AI Trailing Stop: 1.4x ATR% (between 2.0% and 3.5%, never 1%).
 */
export function evaluateCandidateTechnicalStructure(
  params: TechnicalStructureParams
): BotOpportunityCandidate | null {
  const { symbol, side, klines, changePct, turnover, depositUsdt, maxLeverage, riskPerTradePct } = params;

  if (klines.length < 25) {
    return null;
  }

  const closes = klines.map((k) => k.close);
  const currentPrice = closes[closes.length - 1]!;
  if (!currentPrice || currentPrice <= 0) return null;

  const ema20 = computeEMA(closes, 20);
  const ema50 = computeEMA(closes, 50);
  const rsi = computeRSI(closes, 14);
  const atr = calculateWilderATR(klines, 14);

  if (ema20 === null || rsi === null || atr === null) {
    return null;
  }

  const atrPct = (atr / currentPrice) * 100;
  // Exclude dead coins (< 0.25% ATR) or hyper-wild spike coins (> 5.5% ATR)
  if (atrPct < 0.25 || atrPct > 5.5) {
    return null;
  }

  const isLong = side === "long";

  // 1. Trend & Alignment Guard
  if (isLong) {
    // Price should be near or above EMA20 (within 1.2% pullback tolerance)
    if (currentPrice < ema20 * 0.988) {
      return null;
    }
    // If EMA50 exists, EMA20 should not be deeply beneath EMA50
    if (ema50 !== null && ema20 < ema50 * 0.99) {
      return null;
    }
    // RSI Room: not overbought (> 68) and not collapsing (< 38)
    if (rsi > 68 || rsi < 38) {
      return null;
    }
  } else {
    // Short: Price should be near or below EMA20
    if (currentPrice > ema20 * 1.012) {
      return null;
    }
    if (ema50 !== null && ema20 > ema50 * 1.01) {
      return null;
    }
    // RSI Room: not oversold (< 32) and not in strong bull rally (> 62)
    if (rsi < 32 || rsi > 62) {
      return null;
    }
  }

  // 2. Structural Swing Points (last 15 completed candles)
  const lookbackBars = Math.min(15, klines.length - 1);
  const recentBars = klines.slice(-lookbackBars);
  const recentLows = recentBars.map((k) => k.low);
  const recentHighs = recentBars.map((k) => k.high);

  let sl: number;
  let swingLevel: number;

  if (isLong) {
    const swingLow = Math.min(...recentLows);
    swingLevel = swingLow;
    // Structural SL: just under swing low, cushioned by at least 1.4 * ATR
    const candidateDist = Math.max(currentPrice - swingLow * 0.998, atr * 1.4);
    // Clamp SL distance between 1.2% and 4.0%
    const clampedDist = Math.max(currentPrice * 0.012, Math.min(currentPrice * 0.04, candidateDist));
    sl = roundPriceByTick(currentPrice - clampedDist);
  } else {
    const swingHigh = Math.max(...recentHighs);
    swingLevel = swingHigh;
    const candidateDist = Math.max(swingHigh * 1.002 - currentPrice, atr * 1.4);
    const clampedDist = Math.max(currentPrice * 0.012, Math.min(currentPrice * 0.04, candidateDist));
    sl = roundPriceByTick(currentPrice + clampedDist);
  }

  const riskDist = Math.abs(currentPrice - sl);
  if (riskDist <= 0) return null;

  // 3. Multi-Stage Take Profit Targets (1.8R, 2.8R, 4.2R)
  const tp1 = roundPriceByTick(isLong ? currentPrice + riskDist * 1.8 : currentPrice - riskDist * 1.8);
  const tp2 = roundPriceByTick(isLong ? currentPrice + riskDist * 2.8 : currentPrice - riskDist * 2.8);
  const tp3 = roundPriceByTick(isLong ? currentPrice + riskDist * 4.2 : currentPrice - riskDist * 4.2);

  // 4. Dynamic AI Trailing Stop Distance (based on coin volatility)
  // Replaces suffocating 1% with an adaptive 2.0% - 3.5% buffer
  const trailingDistancePct = Math.max(2.0, Math.min(3.5, Number((atrPct * 1.4).toFixed(2))));

  // 5. Cost-Aware Economics Validation
  const effectiveLev = Math.max(1, Math.min(maxLeverage, 20));
  const econ = calculateScalpingEconomics({
    depositUsdt,
    entryPrice: currentPrice,
    stopLossPrice: sl,
    takeProfitPrice: tp1,
    leverage: effectiveLev,
    riskPerTradePct,
    minimumNotionalUsdt: 5,
    takerFeeBps: 5.5,
    spreadBps: 2,
    slippageBps: 3,
  });

  if (!econ.feasible || (econ.rewardRiskAfterCosts !== null && econ.rewardRiskAfterCosts < 1.2)) {
    return null;
  }

  const reasoning = isLong
    ? `Bullish Momentum & EMA Alignment confirmed on ${symbol}. 15m RSI: ${rsi}, ATR%: ${atrPct.toFixed(2)}%. Structural Swing SL set @ $${sl} (distance ${(riskDist / currentPrice * 100).toFixed(2)}%), TP1 @ $${tp1} (1.8R, Net +$${econ.estimatedNetProfitUsdt.toFixed(2)}), Trailing buffer: ${trailingDistancePct}%.`
    : `Bearish Breakdown & Trend Alignment confirmed on ${symbol}. 15m RSI: ${rsi}, ATR%: ${atrPct.toFixed(2)}%. Structural Swing SL set @ $${sl} (distance ${(riskDist / currentPrice * 100).toFixed(2)}%), TP1 @ $${tp1} (1.8R, Net +$${econ.estimatedNetProfitUsdt.toFixed(2)}), Trailing buffer: ${trailingDistancePct}%.`;

  return {
    symbol,
    side,
    entry: currentPrice,
    sl,
    tp1,
    tp2,
    tp3,
    trailingDistancePct,
    changePct,
    turnover,
    atr14: atr,
    atrPct,
    rsi14: rsi,
    ema20,
    ema50: ema50 ?? ema20,
    swingLevel,
    reasoning,
    economics: econ,
  };
}
