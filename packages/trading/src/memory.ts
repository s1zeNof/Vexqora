import type { Kline } from "@crypto-bot/shared";

export type PatternProvenance = "heuristic" | "calibrated";

export interface HistoricalPatternMatch {
  patternId: string;
  patternName: string;
  marketRegime: "High Volatility" | "Trend Continuation" | "Range Consolidation" | "Liquidity Hunt";
  sampleCount: number | null;
  winRatePct: number | null;
  avgRewardRisk: number | null;
  typicalDurationMin: number;
  historicalContext: string;
  isEmpirical: boolean;
  provenance: PatternProvenance;
}

export const HISTORICAL_PATTERNS: HistoricalPatternMatch[] = [
  {
    patternId: "pat-liq-sweep-choch",
    patternName: "Liquidity Sweep + Bullish CHOCH",
    marketRegime: "Liquidity Hunt",
    sampleCount: null,
    winRatePct: null,
    avgRewardRisk: null,
    typicalDurationMin: 35,
    isEmpirical: false,
    provenance: "heuristic",
    historicalContext: "Price swept liquidity below local low, returned into value range and triggered structural shift. Heuristic setup: target value area high with stop below sweep wick."
  },
  {
    patternId: "pat-vol-expansion",
    patternName: "Momentum Breakout & Volume Expansion",
    marketRegime: "Trend Continuation",
    sampleCount: null,
    winRatePct: null,
    avgRewardRisk: null,
    typicalDurationMin: 45,
    isEmpirical: false,
    provenance: "heuristic",
    historicalContext: "Sharp volume surge exceeding baseline during Bollinger Band expansion. Heuristic setup: momentum continuation towards next key liquidity pool."
  },
  {
    patternId: "pat-order-block-abs",
    patternName: "Order Block Sweep & Delta Absorption",
    marketRegime: "High Volatility",
    sampleCount: null,
    winRatePct: null,
    avgRewardRisk: null,
    typicalDurationMin: 28,
    isEmpirical: false,
    provenance: "heuristic",
    historicalContext: "Institutional limit absorption identified by positive delta divergence against falling price. Heuristic setup: bounce towards volume point of control."
  },
  {
    patternId: "pat-exhaustion-revert",
    patternName: "Volume Climax & Mean Reversion",
    marketRegime: "Range Consolidation",
    sampleCount: null,
    winRatePct: null,
    avgRewardRisk: null,
    typicalDurationMin: 20,
    isEmpirical: false,
    provenance: "heuristic",
    historicalContext: "Parabolic exhaustion spike followed by immediate bid exhaustion. Heuristic setup: mean reversion towards volume-weighted average price."
  }
];

export function findHistoricalPatternMatch(
  symbol: string,
  eventType: string,
  changePct: number,
  klines?: Kline[]
): HistoricalPatternMatch {
  const absChange = Math.abs(changePct);

  if (klines && klines.length >= 5) {
    const last = klines[klines.length - 1]!;
    const prev = klines.slice(0, -1);
    const avgVol = prev.reduce((sum, k) => sum + k.volume, 0) / prev.length;
    const volRatio = avgVol > 0 ? last.volume / avgVol : 1;
    const recentLow = Math.min(...prev.map(k => k.low));
    const recentHigh = Math.max(...prev.map(k => k.high));
    const sma = klines.reduce((sum, k) => sum + k.close, 0) / klines.length;

    // 1. Genuine liquidity sweep (price swept recent low and closed positive)
    if (last.low < recentLow && last.close > last.open) {
      return HISTORICAL_PATTERNS[0]!;
    }

    // 2. Volume expansion & momentum
    if (volRatio >= 1.75 || eventType === "volume_spike") {
      return HISTORICAL_PATTERNS[1]!;
    }

    // 3. Exhaustion & Mean reversion
    if (absChange >= 3.5 || eventType === "price_spike" || (last.high > recentHigh && last.close < last.open)) {
      return HISTORICAL_PATTERNS[3]!;
    }

    // 4. Order block absorption & trend
    if (last.close >= sma) {
      return HISTORICAL_PATTERNS[2]!;
    }
  }

  // Fallback pattern matching without klines
  if (eventType === "liquidity_sweep") {
    return HISTORICAL_PATTERNS[0]!;
  }

  if (absChange >= 3.5 || eventType === "price_spike") {
    return HISTORICAL_PATTERNS[3]!;
  }

  if (eventType === "volume_spike") {
    return HISTORICAL_PATTERNS[1]!;
  }

  // Honest unconfirmed discretionary structure instead of random symbol hash selection
  return {
    patternId: "pat-discretionary",
    patternName: "Discretionary Market Structure",
    marketRegime: "Range Consolidation",
    sampleCount: null,
    winRatePct: null,
    avgRewardRisk: null,
    typicalDurationMin: 30,
    isEmpirical: false,
    provenance: "heuristic",
    historicalContext: "No validated SMC liquidity sweep or volume breakout pattern identified. Market structure is discretionary."
  };
}
