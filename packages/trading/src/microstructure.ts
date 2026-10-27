import type { Kline } from "@crypto-bot/shared";
import type {
  ExchangeOrderBook,
  ExchangePublicTrade,
  ExchangeOpenInterestPoint
} from "@crypto-bot/exchange";

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBookImbalance {
  linearImbalance: number; // -1.0 to 1.0 (positive = bid heavy / buy wall, negative = ask heavy / sell wall)
  weightedImbalance: number; // decay weighted, prioritizing top of book
  spreadPct: number;
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  microPrice: number;
  totalBidVolumeUsd: number;
  totalAskVolumeUsd: number;
}

export interface WhaleTradeItem {
  price: number;
  size: number;
  valueUsd: number;
  side: "Buy" | "Sell";
  timestamp: number;
}

export interface TapeAnalysis {
  cvdUsd: number; // Cumulative Volume Delta in USD
  cvdType: "snapshot_recent_trades" | "accumulated_window";
  buyVolumeUsd: number;
  sellVolumeUsd: number;
  whaleTradesCount: number;
  whaleBuyVolumeUsd: number;
  whaleSellVolumeUsd: number;
  buyerAggressionPct: number; // 0 to 100
  whaleTrades: WhaleTradeItem[];
}

export interface LiquiditySweepResult {
  isSweep: boolean;
  type: "sweep_high_bearish" | "sweep_low_bullish" | "none";
  sweptLevel: number;
  rejectionCandleClose: number;
  description: string;
}

export interface DerivativesPressureResult {
  oiChangePct: number | null;
  fundingRatePct: number | null;
  isFundingAvailable: boolean;
  isOiAvailable: boolean;
  squeezeRisk: "short_squeeze_high" | "long_flush_high" | "moderate" | "none" | "unknown";
  description: string;
}

export type MarketRegimeType =
  | "aggressive_buying"
  | "aggressive_selling"
  | "absorption_long"
  | "absorption_short"
  | "short_squeeze"
  | "long_flush"
  | "balanced_auction";

export interface MarketMicrostructure {
  symbol: string;
  timestamp: number;
  orderBook: OrderBookImbalance;
  tape: TapeAnalysis;
  liquiditySweep: LiquiditySweepResult;
  derivatives: DerivativesPressureResult;
  regime: MarketRegimeType;
  dominantBias: "bullish" | "bearish" | "neutral";
  summary: string;
  evidence: string[];
}

/**
 * Calculates raw and decay-weighted order book imbalance from L2 snapshot.
 */
export function calculateOrderBookImbalance(
  bids: OrderBookLevel[],
  asks: OrderBookLevel[],
  depthLimit = 25
): OrderBookImbalance {
  const cleanBids = bids.slice(0, depthLimit);
  const cleanAsks = asks.slice(0, depthLimit);

  if (cleanBids.length === 0 || cleanAsks.length === 0) {
    return {
      linearImbalance: 0,
      weightedImbalance: 0,
      spreadPct: 0,
      bestBid: 0,
      bestAsk: 0,
      midPrice: 0,
      microPrice: 0,
      totalBidVolumeUsd: 0,
      totalAskVolumeUsd: 0
    };
  }

  const bestBid = cleanBids[0]!.price;
  const bestAsk = cleanAsks[0]!.price;
  const midPrice = (bestBid + bestAsk) / 2;
  const spreadPct = midPrice > 0 ? Number((((bestAsk - bestBid) / midPrice) * 100).toFixed(4)) : 0;

  // Micro-price calculation (weight mid-price by opposite top size)
  const topBidSize = cleanBids[0]!.size;
  const topAskSize = cleanAsks[0]!.size;
  const microPrice =
    topBidSize + topAskSize > 0
      ? Number(((bestBid * topAskSize + bestAsk * topBidSize) / (topBidSize + topAskSize)).toFixed(4))
      : midPrice;

  let totalBidVolumeUsd = 0;
  let totalAskVolumeUsd = 0;
  let weightedBidSum = 0;
  let weightedAskSum = 0;

  const decay = 0.08; // exponential decay factor per book tier

  for (let i = 0; i < cleanBids.length; i++) {
    const level = cleanBids[i]!;
    const val = level.price * level.size;
    totalBidVolumeUsd += val;
    const weight = Math.exp(-decay * i);
    weightedBidSum += val * weight;
  }

  for (let i = 0; i < cleanAsks.length; i++) {
    const level = cleanAsks[i]!;
    const val = level.price * level.size;
    totalAskVolumeUsd += val;
    const weight = Math.exp(-decay * i);
    weightedAskSum += val * weight;
  }

  const rawSum = totalBidVolumeUsd + totalAskVolumeUsd;
  const linearImbalance = rawSum > 0 ? Number(((totalBidVolumeUsd - totalAskVolumeUsd) / rawSum).toFixed(4)) : 0;

  const weightedSum = weightedBidSum + weightedAskSum;
  const weightedImbalance = weightedSum > 0 ? Number(((weightedBidSum - weightedAskSum) / weightedSum).toFixed(4)) : 0;

  return {
    linearImbalance,
    weightedImbalance,
    spreadPct,
    bestBid,
    bestAsk,
    midPrice,
    microPrice,
    totalBidVolumeUsd: Math.round(totalBidVolumeUsd),
    totalAskVolumeUsd: Math.round(totalAskVolumeUsd)
  };
}

/**
 * Analyzes public tape trades: Cumulative Volume Delta (CVD) and Whale Block Trades.
 */
export function analyzeRecentTrades(
  trades: Array<{ price: number; size: number; side: "Buy" | "Sell"; timestamp: number }>,
  customWhaleThresholdUsd?: number
): TapeAnalysis {
  if (!trades || trades.length === 0) {
    return {
      cvdUsd: 0,
      cvdType: "snapshot_recent_trades",
      buyVolumeUsd: 0,
      sellVolumeUsd: 0,
      whaleTradesCount: 0,
      whaleBuyVolumeUsd: 0,
      whaleSellVolumeUsd: 0,
      buyerAggressionPct: 50,
      whaleTrades: []
    };
  }

  // Calculate median trade size to establish dynamic threshold
  const values = trades.map((t) => t.price * t.size).sort((a, b) => a - b);
  const medianVal = values[Math.floor(values.length / 2)] ?? 1000;
  // Dynamic threshold: at least $25,000, or 4x median trade size
  const whaleThreshold = customWhaleThresholdUsd ?? Math.max(25_000, medianVal * 4);

  let buyVolumeUsd = 0;
  let sellVolumeUsd = 0;
  let whaleBuyVolumeUsd = 0;
  let whaleSellVolumeUsd = 0;
  const whaleTrades: WhaleTradeItem[] = [];

  for (const t of trades) {
    const val = t.price * t.size;
    if (t.side === "Buy") {
      buyVolumeUsd += val;
      if (val >= whaleThreshold) {
        whaleBuyVolumeUsd += val;
        whaleTrades.push({
          price: t.price,
          size: t.size,
          valueUsd: Math.round(val),
          side: "Buy",
          timestamp: t.timestamp
        });
      }
    } else {
      sellVolumeUsd += val;
      if (val >= whaleThreshold) {
        whaleSellVolumeUsd += val;
        whaleTrades.push({
          price: t.price,
          size: t.size,
          valueUsd: Math.round(val),
          side: "Sell",
          timestamp: t.timestamp
        });
      }
    }
  }

  const totalVol = buyVolumeUsd + sellVolumeUsd;
  const cvdUsd = Math.round(buyVolumeUsd - sellVolumeUsd);
  const buyerAggressionPct = totalVol > 0 ? Number(((buyVolumeUsd / totalVol) * 100).toFixed(1)) : 50;

  return {
    cvdUsd,
    cvdType: "snapshot_recent_trades",
    buyVolumeUsd: Math.round(buyVolumeUsd),
    sellVolumeUsd: Math.round(sellVolumeUsd),
    whaleTradesCount: whaleTrades.length,
    whaleBuyVolumeUsd: Math.round(whaleBuyVolumeUsd),
    whaleSellVolumeUsd: Math.round(whaleSellVolumeUsd),
    buyerAggressionPct,
    whaleTrades: whaleTrades.slice(0, 10) // top 10 recent whales
  };
}

/**
 * Detects structural Liquidity Sweeps (Turtle Soup patterns) on recent klines.
 */
export function detectLiquiditySweep(
  klines: Kline[],
  currentPrice: number
): LiquiditySweepResult {
  if (klines.length < 10) {
    return {
      isSweep: false,
      type: "none",
      sweptLevel: 0,
      rejectionCandleClose: currentPrice,
      description: "Insufficient klines for liquidity sweep detection"
    };
  }

  // Look back at previous 20 periods (excluding current candle)
  const lookback = klines.slice(Math.max(0, klines.length - 21), klines.length - 1);
  const currentCandle = klines[klines.length - 1]!;

  const swingHigh = Math.max(...lookback.map((k) => k.high));
  const swingLow = Math.min(...lookback.map((k) => k.low));

  // Bearish Liquidity Sweep (Turtle Soup Short):
  // Candle breached swing high, but closed or returned back below the swing high
  if (currentCandle.high > swingHigh && currentPrice < swingHigh) {
    return {
      isSweep: true,
      type: "sweep_high_bearish",
      sweptLevel: swingHigh,
      rejectionCandleClose: currentPrice,
      description: `Bearish Liquidity Sweep: Price spiked above recent swing high (${swingHigh}) to trigger buy stops, but rejected back down to ${currentPrice}.`
    };
  }

  // Bullish Liquidity Sweep (Turtle Soup Long):
  // Candle breached swing low, but closed or returned back above the swing low
  if (currentCandle.low < swingLow && currentPrice > swingLow) {
    return {
      isSweep: true,
      type: "sweep_low_bullish",
      sweptLevel: swingLow,
      rejectionCandleClose: currentPrice,
      description: `Bullish Liquidity Sweep: Price pierced recent swing low (${swingLow}) to trap sellers/stop outs, but rebounded back above to ${currentPrice}.`
    };
  }

  return {
    isSweep: false,
    type: "none",
    sweptLevel: 0,
    rejectionCandleClose: currentPrice,
    description: "No liquidity sweep detected against 20-period swing high/low."
  };
}

/**
 * Analyzes derivatives positioning (Open Interest & Funding Rate) for squeeze risks.
 */
export function analyzeDerivativesPressure(
  oiPoints?: ExchangeOpenInterestPoint[],
  fundingRate?: number | null,
  priceChangePct: number = 0
): DerivativesPressureResult {
  const isFundingAvailable = typeof fundingRate === "number" && !isNaN(fundingRate);
  const fundingRatePct = isFundingAvailable ? Number((fundingRate * 100).toFixed(4)) : null;

  const isOiAvailable = Array.isArray(oiPoints) && oiPoints.length >= 2;
  if (!isOiAvailable) {
    return {
      oiChangePct: null,
      fundingRatePct,
      isFundingAvailable,
      isOiAvailable: false,
      squeezeRisk: isFundingAvailable && Math.abs(fundingRatePct!) > 0.05 ? "moderate" : "unknown",
      description: isFundingAvailable
        ? `Funding rate is ${fundingRatePct}%. Open Interest historical data unavailable.`
        : "Derivatives metrics (OI & Funding Rate) unavailable from exchange feed."
    };
  }

  const latestOI = oiPoints[oiPoints.length - 1]!.openInterest;
  const initialOI = oiPoints[0]!.openInterest;
  const oiChangePct = initialOI > 0 ? Number((((latestOI - initialOI) / initialOI) * 100).toFixed(2)) : 0;

  // Short Squeeze Detection
  if (isFundingAvailable && priceChangePct >= 2.5 && oiChangePct <= -2.0 && fundingRatePct! <= -0.01) {
    return {
      oiChangePct,
      fundingRatePct,
      isFundingAvailable: true,
      isOiAvailable: true,
      squeezeRisk: "short_squeeze_high",
      description: `Short Squeeze Active: Price up +${priceChangePct}% while OI dropped ${oiChangePct}% with negative funding (${fundingRatePct}%). Aggressive shorts are being forced to cover.`
    };
  }

  // Long Flush
  if (isFundingAvailable && priceChangePct <= -2.5 && oiChangePct <= -2.0 && fundingRatePct! >= 0.01) {
    return {
      oiChangePct,
      fundingRatePct,
      isFundingAvailable: true,
      isOiAvailable: true,
      squeezeRisk: "long_flush_high",
      description: `Long Flush Active: Price down ${priceChangePct}% while OI dropped ${oiChangePct}% with positive funding (${fundingRatePct}%). Overleveraged longs liquidated.`
    };
  }

  return {
    oiChangePct,
    fundingRatePct,
    isFundingAvailable,
    isOiAvailable: true,
    squeezeRisk: isFundingAvailable && Math.abs(fundingRatePct!) > 0.03 ? "moderate" : "none",
    description: `OI changed ${oiChangePct >= 0 ? "+" : ""}${oiChangePct}% over window.${isFundingAvailable ? ` Funding rate is ${fundingRatePct}%.` : " Funding rate unavailable."}`
  };
}

/**
 * Determines current market microstructure regime based on order book and tape flow.
 */
export function classifyMarketRegime(
  orderBook: OrderBookImbalance,
  tape: TapeAnalysis,
  derivatives: DerivativesPressureResult,
  priceChangePct: number
): MarketRegimeType {
  if (derivatives.squeezeRisk === "short_squeeze_high") return "short_squeeze";
  if (derivatives.squeezeRisk === "long_flush_high") return "long_flush";

  // Absorption Long: Aggressive market sells (negative CVD) but price is flat/positive and strong bid depth
  if (tape.cvdUsd < -50_000 && priceChangePct >= -0.2 && orderBook.weightedImbalance > 0.15) {
    return "absorption_long";
  }

  // Absorption Short: Aggressive market buys (positive CVD) but price is flat/negative and strong ask depth
  if (tape.cvdUsd > 50_000 && priceChangePct <= 0.2 && orderBook.weightedImbalance < -0.15) {
    return "absorption_short";
  }

  // Aggressive Buying: Strong positive CVD, order book bid skewed, price expanding up
  if (tape.cvdUsd > 20_000 && orderBook.weightedImbalance > 0.2 && priceChangePct > 0.5) {
    return "aggressive_buying";
  }

  // Aggressive Selling: Strong negative CVD, order book ask skewed, price dumping down
  if (tape.cvdUsd < -20_000 && orderBook.weightedImbalance < -0.2 && priceChangePct < -0.5) {
    return "aggressive_selling";
  }

  return "balanced_auction";
}

/**
 * Evaluates comprehensive market microstructure by orchestrating order book, tape, klines and derivatives.
 */
export function evaluateMarketMicrostructure(params: {
  symbol: string;
  orderBook: ExchangeOrderBook | null;
  trades: ExchangePublicTrade[];
  klines: Kline[];
  oiPoints?: ExchangeOpenInterestPoint[];
  fundingRate?: number;
  priceChangePct?: number;
}): MarketMicrostructure {
  const symbol = params.symbol.toUpperCase();
  const timestamp = Date.now();
  const priceChange = params.priceChangePct ?? 0;

  const obResult = params.orderBook
    ? calculateOrderBookImbalance(params.orderBook.bids, params.orderBook.asks)
    : {
        linearImbalance: 0,
        weightedImbalance: 0,
        spreadPct: 0,
        bestBid: 0,
        bestAsk: 0,
        midPrice: 0,
        microPrice: 0,
        totalBidVolumeUsd: 0,
        totalAskVolumeUsd: 0
      };

  const tapeResult = analyzeRecentTrades(params.trades);
  const currentPrice = obResult.midPrice > 0 ? obResult.midPrice : (params.klines[params.klines.length - 1]?.close ?? 0);
  const sweepResult = detectLiquiditySweep(params.klines, currentPrice);
  const derivativesResult = analyzeDerivativesPressure(params.oiPoints, params.fundingRate, priceChange);

  const regime = classifyMarketRegime(obResult, tapeResult, derivativesResult, priceChange);

  // Derive dominant bias
  let bullishSignals = 0;
  let bearishSignals = 0;
  const evidence: string[] = [];

  if (obResult.weightedImbalance >= 0.2) {
    bullishSignals++;
    evidence.push(`Order Book: Strong bid-side imbalance (+${Math.round(obResult.weightedImbalance * 100)}%)`);
  } else if (obResult.weightedImbalance <= -0.2) {
    bearishSignals++;
    evidence.push(`Order Book: Strong ask-side resistance (${Math.round(obResult.weightedImbalance * 100)}%)`);
  }

  if (tapeResult.cvdUsd > 30_000) {
    bullishSignals++;
    evidence.push(`Tape CVD: Aggressive net buying of +$${tapeResult.cvdUsd.toLocaleString()}`);
  } else if (tapeResult.cvdUsd < -30_000) {
    bearishSignals++;
    evidence.push(`Tape CVD: Aggressive net selling of -$${Math.abs(tapeResult.cvdUsd).toLocaleString()}`);
  }

  if (tapeResult.whaleBuyVolumeUsd > tapeResult.whaleSellVolumeUsd && tapeResult.whaleTradesCount > 0) {
    bullishSignals++;
    evidence.push(`Whale Activity: $${tapeResult.whaleBuyVolumeUsd.toLocaleString()} block buys vs $${tapeResult.whaleSellVolumeUsd.toLocaleString()} block sells`);
  } else if (tapeResult.whaleSellVolumeUsd > tapeResult.whaleBuyVolumeUsd && tapeResult.whaleTradesCount > 0) {
    bearishSignals++;
    evidence.push(`Whale Activity: $${tapeResult.whaleSellVolumeUsd.toLocaleString()} block sells vs $${tapeResult.whaleBuyVolumeUsd.toLocaleString()} block buys`);
  }

  if (sweepResult.type === "sweep_low_bullish") {
    bullishSignals += 2;
    evidence.push(sweepResult.description);
  } else if (sweepResult.type === "sweep_high_bearish") {
    bearishSignals += 2;
    evidence.push(sweepResult.description);
  }

  if (derivativesResult.squeezeRisk === "short_squeeze_high") {
    bullishSignals += 2;
    evidence.push(derivativesResult.description);
  } else if (derivativesResult.squeezeRisk === "long_flush_high") {
    bearishSignals += 2;
    evidence.push(derivativesResult.description);
  }

  let dominantBias: "bullish" | "bearish" | "neutral" = "neutral";
  if (bullishSignals > bearishSignals && bullishSignals >= 2) dominantBias = "bullish";
  else if (bearishSignals > bullishSignals && bearishSignals >= 2) dominantBias = "bearish";

  const summary = `${symbol} microstructure: ${regime.replace("_", " ").toUpperCase()} · Bias: ${dominantBias.toUpperCase()} · OBI: ${obResult.weightedImbalance >= 0 ? "+" : ""}${Math.round(obResult.weightedImbalance * 100)}% · CVD: ${tapeResult.cvdUsd >= 0 ? "+" : ""}$${tapeResult.cvdUsd.toLocaleString()}`;

  return {
    symbol,
    timestamp,
    orderBook: obResult,
    tape: tapeResult,
    liquiditySweep: sweepResult,
    derivatives: derivativesResult,
    regime,
    dominantBias,
    summary,
    evidence
  };
}
