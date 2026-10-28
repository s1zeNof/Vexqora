import { formatCryptoPrice } from "@crypto-bot/shared";
import { roundToStep } from "./risk";
import { calculateRSI } from "./feature-registry";
import { callNemotron } from "./nemotron";
import { getSensibleTickSize } from "./ai-copilot";

export interface CopilotTradeScenario {
  id: "conservative" | "momentum" | "deep_swing";
  name: string;
  badge: string;
  isRecommended: boolean;
  orderType: "Limit" | "Market";
  side: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  slDistancePct: number;
  tp1: number;
  tp1DistancePct: number;
  tp2: number;
  tp2DistancePct: number;
  tp3: number;
  tp3DistancePct: number;
  leverage: number;
  allocatedMarginUsdt: number;
  notionalUsdt: number;
  approxQty: number;
  maxLossUsdt: number;
  targetGainUsdt: number;
  riskRewardRatio: number;
  winProbabilityPct: number | null;
  thesis: string;
  invalidation: string;
  rawSignalText: string;
}

export interface CopilotMarketData {
  symbol: string;
  currentPrice: number;
  price24hPcnt: number;
  high24h: number;
  low24h: number;
  volume24hUsd: number;
  fundingRatePct: number;
  orderBookImbalancePct: number | null;
  buyerAggressionPct: number | null;
  trend15m: "bullish" | "bearish" | "ranging";
  rsi15m: number;
}

export interface CopilotAnalystResult {
  query: string;
  detectedSymbol: string;
  detectedBudget: number;
  marketData: CopilotMarketData;
  aiAnalysis: {
    title: string;
    marketConditionSummary: string;
    orderFlowObservation: string;
    bestScenarioId: string;
    recommendationReason: string;
    keyRiskWarnings: string[];
    actionSteps: string[];
    fullMarkdownText: string;
  };
  scenarios: CopilotTradeScenario[];
}

const COMMON_SYMBOLS_MAP: Record<string, string> = {
  btc: "BTCUSDT",
  bitcoin: "BTCUSDT",
  біткоїн: "BTCUSDT",
  биткоин: "BTCUSDT",
  eth: "ETHUSDT",
  ethereum: "ETHUSDT",
  ефір: "ETHUSDT",
  эфир: "ETHUSDT",
  sol: "SOLUSDT",
  solana: "SOLUSDT",
  солана: "SOLUSDT",
  xrp: "XRPUSDT",
  ripple: "XRPUSDT",
  ріпл: "XRPUSDT",
  doge: "DOGEUSDT",
  догі: "DOGEUSDT",
  pepe: "PEPEUSDT",
  пепе: "PEPEUSDT",
  sui: "SUIUSDT",
  суї: "SUIUSDT",
  near: "NEARUSDT",
  ніар: "NEARUSDT",
  ton: "TONUSDT",
  тон: "TONUSDT",
  avax: "AVAXUSDT",
  авакс: "AVAXUSDT",
  link: "LINKUSDT",
  лінк: "LINKUSDT",
  arb: "ARBUSDT",
  арб: "ARBUSDT",
  op: "OPUSDT",
  apt: "APTUSDT",
  аптос: "APTUSDT",
  ada: "ADAUSDT",
  кардано: "ADAUSDT",
  matic: "MATICUSDT",
  полігон: "MATICUSDT",
  dot: "DOTUSDT",
  полкадот: "DOTUSDT",
  shib: "SHIBUSDT",
  шиба: "SHIBUSDT",
  ltc: "LTCUSDT",
  лайткоїн: "LTCUSDT",
  trx: "TRXUSDT",
  трон: "TRXUSDT",
  bch: "BCHUSDT",
  tia: "TIAUSDT",
  inj: "INJUSDT",
  rndr: "RNDRUSDT",
  fet: "FETUSDT",
  wif: "WIFUSDT",
  floki: "FLOKIUSDT",
  bonk: "BONKUSDT",
  ena: "ENAUSDT",
  wld: "WLDUSDT",
  jup: "JUPUSDT",
  pendle: "PENDLEUSDT",
  blend: "BLENDUSDT",
  irys: "IRYSUSDT"
};

const STEM_MAP: Array<[RegExp, string]> = [
  [/бітко[їі]н/i, "BTCUSDT"],
  [/биткоин/i, "BTCUSDT"],
  [/ефір/i, "ETHUSDT"],
  [/эфир/i, "ETHUSDT"],
  [/солан/i, "SOLUSDT"],
  [/ріпл/i, "XRPUSDT"],
  [/дог[іе]/i, "DOGEUSDT"],
  [/пепе/i, "PEPEUSDT"],
  [/су[іі]/i, "SUIUSDT"],
  [/ніар/i, "NEARUSDT"],
  [/кардан/i, "ADAUSDT"],
  [/авакс/i, "AVAXUSDT"],
  [/лайтко[їі]н/i, "LTCUSDT"],
  [/полігон/i, "MATICUSDT"],
  [/полкадот/i, "DOTUSDT"],
  [/ірис|айріс|irys/i, "IRYSUSDT"]
];

/**
 * Extracts cryptocurrency ticker symbol from user free-form query.
 */
export function extractTokenFromPrompt(prompt: string): string {
  const clean = prompt.toLowerCase();

  // 1. Check Cyrillic stems with inflections (ефіру, солани, біткоїна тощо)
  for (const [re, sym] of STEM_MAP) {
    if (re.test(clean)) {
      return sym;
    }
  }

  // 2. Direct dictionary matches
  for (const [key, sym] of Object.entries(COMMON_SYMBOLS_MAP)) {
    const regex = new RegExp(`(?:\\b|\\s|_|-)${key}(?:\\b|\\s|_|-)`, "i");
    if (regex.test(clean)) {
      return sym;
    }
  }

  // 3. Look for phrases like "монету SOL", "в SOL", "пару SOL"
  const phraseMatch = /(?:монет[уаиі]?|монети|пару|крипт[уа]?|токен|вход[уа]?\s+в|по)\s+([A-Za-z0-9]{2,12})/i.exec(prompt);
  if (phraseMatch?.[1]) {
    const token = phraseMatch[1].toUpperCase();
    if (token.endsWith("USDT")) return token;
    return `${token}USDT`;
  }

  // 4. Look for raw uppercase TICKERUSDT pattern
  const usdtMatch = /\b([A-Z0-9]{2,10})USDT\b/i.exec(prompt);
  if (usdtMatch?.[1]) {
    return `${usdtMatch[1].toUpperCase()}USDT`;
  }

  // 5. Look for standalone uppercase 3-5 letter words
  const standaloneMatch = /\b([A-Z]{3,5})\b/.exec(prompt);
  if (standaloneMatch?.[1]) {
    const word = standaloneMatch[1];
    if (!["USDT", "USDC", "USD", "EUR", "FOR", "AND", "THE"].includes(word)) {
      return `${word}USDT`;
    }
  }

  // Fallback to BTCUSDT
  return "BTCUSDT";
}

/**
 * Extracts deposit budget in USDT from user prompt or defaults to user's balance.
 */
export function extractBudgetFromPrompt(prompt: string, userBalance?: number): number {
  // Look for patterns like "15$", "$15", "15 USDT", "15 баксів", "15.50$"
  const regexes = [
    /(?:\$|USD\s*|USDT\s*)(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*(?:\$|usdt|usd|bucks|бакс|дол)/i,
    /(?:маю|депозит|бюджет|сума|баланс)[^0-9]*(\d+(?:\.\d+)?)/i
  ];

  for (const r of regexes) {
    const match = r.exec(prompt);
    if (match?.[1]) {
      const parsed = parseFloat(match[1]);
      if (!isNaN(parsed) && parsed > 0) {
        return Number(parsed.toFixed(2));
      }
    }
  }

  // If no budget stated in prompt, use available wallet balance or standard $15
  if (typeof userBalance === "number" && userBalance > 0) {
    return Number(userBalance.toFixed(2));
  }

  return 15.0;
}

/**
 * Fetches real-time market data across Bybit and Binance without synthetic fallbacks.
 */
export async function fetchCopilotMarketData(symbol: string): Promise<CopilotMarketData> {
  const normSymbol = symbol.trim().toUpperCase();

  let currentPrice = 0;
  let high24h = 0;
  let low24h = 0;
  let price24hPcnt = 0;
  let volume24hUsd = 0;
  let fundingRatePct = 0;
  let orderBookImbalancePct: number | null = null;
  let buyerAggressionPct: number | null = null;
  let trend15m: "bullish" | "bearish" | "ranging" = "ranging";
  let rsi15m = 50;

  // 1. Fetch Bybit linear ticker, klines and orderbook in parallel
  try {
    const [tickerRes, klinesRes, obRes] = await Promise.allSettled([
      fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${normSymbol}`, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      }),
      fetch(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${normSymbol}&interval=15&limit=40`, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      }),
      fetch(`https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${normSymbol}&limit=25`, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      })
    ]);

    if (tickerRes.status === "fulfilled" && tickerRes.value.ok) {
      const tData = (await tickerRes.value.json()) as {
        result?: {
          list?: Array<{
            lastPrice?: string;
            highPrice24h?: string;
            lowPrice24h?: string;
            price24hPcnt?: string;
            turnover24h?: string;
            fundingRate?: string;
          }>;
        };
      };
      const t = tData.result?.list?.[0];
      if (t) {
        currentPrice = Number(t.lastPrice) || 0;
        high24h = Number(t.highPrice24h) || 0;
        low24h = Number(t.lowPrice24h) || 0;
        price24hPcnt = Number(t.price24hPcnt) * 100 || 0;
        volume24hUsd = Number(t.turnover24h) || 0;
        fundingRatePct = Number(t.fundingRate) * 100 || 0;
      }
    }

    if (klinesRes.status === "fulfilled" && klinesRes.value.ok) {
      const kData = (await klinesRes.value.json()) as {
        result?: { list?: string[][] };
      };
      const rawList = kData.result?.list ?? [];
      const closes = rawList
        .map((k) => Number(k[4]))
        .filter((n) => Number.isFinite(n) && n > 0)
        .reverse();

      if (closes.length > 0) {
        if (currentPrice === 0) {
          currentPrice = closes[closes.length - 1] ?? 0;
        }

        if (closes.length >= 15) {
          const rsiSeries = calculateRSI(closes, 14);
          const lastRsi = rsiSeries[rsiSeries.length - 1];
          if (typeof lastRsi === "number" && !isNaN(lastRsi)) {
            rsi15m = Math.round(lastRsi);
          }
        }

        if (closes.length >= 20) {
          const k = 2 / (20 + 1);
          let ema = closes[0] ?? currentPrice;
          for (let i = 1; i < closes.length; i++) {
            const c = closes[i] ?? currentPrice;
            ema = c * k + ema * (1 - k);
          }
          const diffPct = ((currentPrice - ema) / ema) * 100;
          if (diffPct > 0.4) trend15m = "bullish";
          else if (diffPct < -0.4) trend15m = "bearish";
          else trend15m = "ranging";
        }
      }
    }

    if (obRes.status === "fulfilled" && obRes.value.ok) {
      const oData = (await obRes.value.json()) as {
        result?: {
          b?: string[][];
          a?: string[][];
        };
      };
      const bids = (oData.result?.b ?? []).map((b) => ({ price: Number(b[0]), qty: Number(b[1]) }));
      const asks = (oData.result?.a ?? []).map((a) => ({ price: Number(a[0]), qty: Number(a[1]) }));

      const totalBidVolUsd = bids.reduce((sum, b) => sum + b.price * b.qty, 0);
      const totalAskVolUsd = asks.reduce((sum, a) => sum + a.price * a.qty, 0);
      const totalVol = totalBidVolUsd + totalAskVolUsd;

      if (totalVol > 0) {
        const rawImbalance = (totalBidVolUsd - totalAskVolUsd) / totalVol;
        orderBookImbalancePct = Number((rawImbalance * 100).toFixed(1));
        buyerAggressionPct = Number(((totalBidVolUsd / totalVol) * 100).toFixed(1));
      }
    }
  } catch {
    // continue to fallback
  }

  // Fallback to Binance if Bybit price is missing
  if (currentPrice === 0) {
    try {
      const bRes = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${normSymbol}`, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (bRes.ok) {
        const b = (await bRes.json()) as {
          lastPrice?: string;
          highPrice?: string;
          lowPrice?: string;
          priceChangePercent?: string;
          quoteVolume?: string;
        };
        currentPrice = Number(b.lastPrice) || 0;
        high24h = Number(b.highPrice) || 0;
        low24h = Number(b.lowPrice) || 0;
        price24hPcnt = Number(b.priceChangePercent) || 0;
        volume24hUsd = Number(b.quoteVolume) || 0;
      }
    } catch {
      // ignore
    }
  }

  // Strict P0-02 check: Do NOT hallucinate synthetic prices like BTC 67500 or SOL 175
  if (currentPrice === 0) {
    throw new Error(`[DATA_UNAVAILABLE] Failed to fetch live market price for ${normSymbol}. Synthetic fallbacks are prohibited.`);
  }

  return {
    symbol: normSymbol,
    currentPrice,
    price24hPcnt: Number(price24hPcnt.toFixed(2)),
    high24h: high24h > 0 ? high24h : currentPrice,
    low24h: low24h > 0 ? low24h : currentPrice,
    volume24hUsd,
    fundingRatePct: Number(fundingRatePct.toFixed(4)),
    orderBookImbalancePct,
    buyerAggressionPct,
    trend15m,
    rsi15m
  };
}

/**
 * Computes 3 mathematically rigorous trade scenarios tailored to user's exact balance.
 * Implements directional diversity: if market is down (e.g. -13% like IRYS), primary scenarios are SHORT,
 * with an alternative counter-trend LONG hedge scenario so the trader has both options.
 */
export function calculateCopilotScenarios(
  market: CopilotMarketData,
  budget: number,
  userPrompt: string
): { scenarios: CopilotTradeScenario[]; bestScenarioId: string } {
  const normSymbol = market.symbol;
  const currentPrice = market.currentPrice;
  const tickSize = getSensibleTickSize(currentPrice);

  const lowerPrompt = userPrompt.toLowerCase();
  const userForcedShort = lowerPrompt.includes("шорт") || lowerPrompt.includes("short") || lowerPrompt.includes("падінн") || lowerPrompt.includes("продати");
  const userForcedLong = lowerPrompt.includes("лонг") || lowerPrompt.includes("long") || lowerPrompt.includes("ріст") || lowerPrompt.includes("куп");

  // Multi-factor directional assessment
  const is24hHeavyDrop = market.price24hPcnt < -2.5;
  const isTrendBearish = market.trend15m === "bearish";
  const isFundingNegative = market.fundingRatePct < -0.005;
  const isOrderBookSelling = (market.orderBookImbalancePct ?? 0) < -10;
  const isRsiBearish = market.rsi15m < 45;

  let bearishScore = 0;
  if (is24hHeavyDrop) bearishScore += 2;
  if (isTrendBearish) bearishScore += 2;
  if (isFundingNegative) bearishScore += 1;
  if (isOrderBookSelling) bearishScore += 1;
  if (isRsiBearish) bearishScore += 1;

  const is24hHeavyPump = market.price24hPcnt > 2.5;
  const isTrendBullish = market.trend15m === "bullish";
  const isFundingPositive = market.fundingRatePct > 0.005;
  const isOrderBookBuying = (market.orderBookImbalancePct ?? 0) > 10;
  const isRsiBullish = market.rsi15m > 55;

  let bullishScore = 0;
  if (is24hHeavyPump) bullishScore += 2;
  if (isTrendBullish) bullishScore += 2;
  if (isFundingPositive) bullishScore += 1;
  if (isOrderBookBuying) bullishScore += 1;
  if (isRsiBullish) bullishScore += 1;

  const primarySide: "long" | "short" = userForcedShort
    ? "short"
    : userForcedLong
    ? "long"
    : bearishScore > bullishScore
    ? "short"
    : "long";

  const rTick = (p: number) => roundToStep(p, tickSize);

  // Dynamic volatility-calibrated distance
  const measuredRangePct = market.high24h > market.low24h && currentPrice > 0
    ? ((market.high24h - market.low24h) / currentPrice) * 100
    : 3.5;
  const dynamicBaseSL = Math.max(1.4, Math.min(4.5, measuredRangePct * 0.28));

  // Determine scenario directions:
  // If user specified a side: all 3 focus on that side.
  // If user did not specify: Scenarios 1 & 2 follow primary trend, Scenario 3 offers the alternative counter-trend option!
  const sc1Side: "long" | "short" = primarySide;
  const sc2Side: "long" | "short" = primarySide;
  const sc3Side: "long" | "short" = userForcedShort ? "short" : userForcedLong ? "long" : (primarySide === "short" ? "long" : "short");

  // ----------------------------------------------------
  // SCENARIO 1: Консервативний (Лімітний відкат / Retest into FVG)
  // ----------------------------------------------------
  const sc1IsLong = sc1Side === "long";
  const sc1Entry = rTick(sc1IsLong ? currentPrice * (1 - dynamicBaseSL * 0.006) : currentPrice * (1 + dynamicBaseSL * 0.006));
  const sc1SLDistPct = Number((dynamicBaseSL * 0.9).toFixed(1));
  const sc1SL = rTick(sc1IsLong ? sc1Entry * (1 - sc1SLDistPct / 100) : sc1Entry * (1 + sc1SLDistPct / 100));
  const sc1TP1DistPct = Number((sc1SLDistPct * 1.6).toFixed(1));
  const sc1TP2DistPct = Number((sc1SLDistPct * 2.8).toFixed(1));
  const sc1TP3DistPct = Number((sc1SLDistPct * 4.4).toFixed(1));
  const sc1TP1 = rTick(sc1IsLong ? sc1Entry * (1 + sc1TP1DistPct / 100) : sc1Entry * (1 - sc1TP1DistPct / 100));
  const sc1TP2 = rTick(sc1IsLong ? sc1Entry * (1 + sc1TP2DistPct / 100) : sc1Entry * (1 - sc1TP2DistPct / 100));
  const sc1TP3 = rTick(sc1IsLong ? sc1Entry * (1 + sc1TP3DistPct / 100) : sc1Entry * (1 - sc1TP3DistPct / 100));
  const sc1Leverage = 5;
  const sc1Notional = budget * sc1Leverage;
  const sc1Qty = sc1Entry > 0 ? Number((sc1Notional / sc1Entry).toFixed(4)) : 0;
  const sc1MaxLoss = Number((budget * (sc1SLDistPct / 100) * sc1Leverage).toFixed(2));
  const sc1WeightedGainPct = (sc1TP1DistPct * 0.4 + sc1TP2DistPct * 0.35 + sc1TP3DistPct * 0.25);
  const sc1TargetGain = Number((budget * (sc1WeightedGainPct / 100) * sc1Leverage).toFixed(2));
  const sc1RR = Number((sc1WeightedGainPct / sc1SLDistPct).toFixed(2));

  const sc1RawSignal = `${normSymbol} ${sc1Side.toUpperCase()}
entry ${sc1Entry}
sl ${sc1SL}
tp ${sc1TP1} 40%, ${sc1TP2} 35%, ${sc1TP3} 25%
trail 1% after tp1
lev ${sc1Leverage}`;

  // ----------------------------------------------------
  // SCENARIO 2: Агресивний (Моментум / Вхід по ринку)
  // ----------------------------------------------------
  const sc2IsLong = sc2Side === "long";
  const sc2Entry = currentPrice;
  const sc2SLDistPct = Number((dynamicBaseSL * 1.2).toFixed(1));
  const sc2SL = rTick(sc2IsLong ? sc2Entry * (1 - sc2SLDistPct / 100) : sc2Entry * (1 + sc2SLDistPct / 100));
  const sc2TP1DistPct = Number((sc2SLDistPct * 1.3).toFixed(1));
  const sc2TP2DistPct = Number((sc2SLDistPct * 2.2).toFixed(1));
  const sc2TP3DistPct = Number((sc2SLDistPct * 3.4).toFixed(1));
  const sc2TP1 = rTick(sc2IsLong ? sc2Entry * (1 + sc2TP1DistPct / 100) : sc2Entry * (1 - sc2TP1DistPct / 100));
  const sc2TP2 = rTick(sc2IsLong ? sc2Entry * (1 + sc2TP2DistPct / 100) : sc2Entry * (1 - sc2TP2DistPct / 100));
  const sc2TP3 = rTick(sc2IsLong ? sc2Entry * (1 + sc2TP3DistPct / 100) : sc2Entry * (1 - sc2TP3DistPct / 100));
  const sc2Leverage = 5;
  const sc2Notional = budget * sc2Leverage;
  const sc2Qty = sc2Entry > 0 ? Number((sc2Notional / sc2Entry).toFixed(4)) : 0;
  const sc2MaxLoss = Number((budget * (sc2SLDistPct / 100) * sc2Leverage).toFixed(2));
  const sc2WeightedGainPct = (sc2TP1DistPct * 0.4 + sc2TP2DistPct * 0.35 + sc2TP3DistPct * 0.25);
  const sc2TargetGain = Number((budget * (sc2WeightedGainPct / 100) * sc2Leverage).toFixed(2));
  const sc2RR = Number((sc2WeightedGainPct / sc2SLDistPct).toFixed(2));

  const sc2RawSignal = `${normSymbol} ${sc2Side.toUpperCase()}
entry market
sl ${sc2SL}
tp ${sc2TP1} 40%, ${sc2TP2} 35%, ${sc2TP3} 25%
trail 1% after tp1
lev ${sc2Leverage}`;

  // ----------------------------------------------------
  // SCENARIO 3: Свінг / Контртрендовий хедж (Альтернативний сценарій)
  // ----------------------------------------------------
  const sc3IsLong = sc3Side === "long";
  const isCounterTrend = sc3Side !== primarySide;
  const sc3Entry = rTick(sc3IsLong ? currentPrice * (1 - dynamicBaseSL * 0.012) : currentPrice * (1 + dynamicBaseSL * 0.012));
  const sc3SLDistPct = Number((dynamicBaseSL * 1.5).toFixed(1));
  const sc3SL = rTick(sc3IsLong ? sc3Entry * (1 - sc3SLDistPct / 100) : sc3Entry * (1 + sc3SLDistPct / 100));
  const sc3TP1DistPct = Number((sc3SLDistPct * 1.8).toFixed(1));
  const sc3TP2DistPct = Number((sc3SLDistPct * 3.0).toFixed(1));
  const sc3TP3DistPct = Number((sc3SLDistPct * 4.8).toFixed(1));
  const sc3TP1 = rTick(sc3IsLong ? sc3Entry * (1 + sc3TP1DistPct / 100) : sc3Entry * (1 - sc3TP1DistPct / 100));
  const sc3TP2 = rTick(sc3IsLong ? sc3Entry * (1 + sc3TP2DistPct / 100) : sc3Entry * (1 - sc3TP2DistPct / 100));
  const sc3TP3 = rTick(sc3IsLong ? sc3Entry * (1 + sc3TP3DistPct / 100) : sc3Entry * (1 - sc3TP3DistPct / 100));
  const sc3Leverage = isCounterTrend ? 3 : 4; // reduced leverage for counter-trend or swing
  const sc3Notional = budget * sc3Leverage;
  const sc3Qty = sc3Entry > 0 ? Number((sc3Notional / sc3Entry).toFixed(4)) : 0;
  const sc3MaxLoss = Number((budget * (sc3SLDistPct / 100) * sc3Leverage).toFixed(2));
  const sc3WeightedGainPct = (sc3TP1DistPct * 0.5 + sc3TP2DistPct * 0.3 + sc3TP3DistPct * 0.2);
  const sc3TargetGain = Number((budget * (sc3WeightedGainPct / 100) * sc3Leverage).toFixed(2));
  const sc3RR = Number((sc3WeightedGainPct / sc3SLDistPct).toFixed(2));

  const sc3RawSignal = `${normSymbol} ${sc3Side.toUpperCase()}
entry ${sc3Entry}
sl ${sc3SL}
tp ${sc3TP1} 50%, ${sc3TP2} 30%, ${sc3TP3} 20%
trail 1.5% after tp1
lev ${sc3Leverage}`;

  let bestScenarioId = "conservative";
  if (Math.abs(market.price24hPcnt) > 6 && Math.abs(market.orderBookImbalancePct ?? 0) > 20) {
    bestScenarioId = "momentum";
  }

  const scenarios: CopilotTradeScenario[] = [
    {
      id: "conservative",
      name: `Консервативний (Лімітний ${sc1Side === "long" ? "відкат" : "ретест"})`,
      badge: "🛡️ Оптимальний R:R",
      isRecommended: bestScenarioId === "conservative",
      orderType: "Limit",
      side: sc1Side,
      entryPrice: sc1Entry,
      stopLoss: sc1SL,
      slDistancePct: sc1SLDistPct,
      tp1: sc1TP1,
      tp1DistancePct: sc1TP1DistPct,
      tp2: sc1TP2,
      tp2DistancePct: sc1TP2DistPct,
      tp3: sc1TP3,
      tp3DistancePct: sc1TP3DistPct,
      leverage: sc1Leverage,
      allocatedMarginUsdt: budget,
      notionalUsdt: sc1Notional,
      approxQty: sc1Qty,
      maxLossUsdt: sc1MaxLoss,
      targetGainUsdt: sc1TargetGain,
      riskRewardRatio: sc1RR,
      winProbabilityPct: null, // P0-01: calibrated OOS model only
      thesis: sc1Side === "short"
        ? `Лімітний шорт на відкаті вгору до зони локального опору / FVG на $${formatCryptoPrice(sc1Entry)}. Дозволяє увійти за спадним трендом із коротким стопом ($${formatCryptoPrice(sc1SL)}) та R:R 1:${sc1RR}.`
        : `Очікування відкату до зони ліквідності / підтримки на $${formatCryptoPrice(sc1Entry)}. Вхід лімітним ордером дає мінімальний стоп ($${formatCryptoPrice(sc1SL)}) та вигідний R:R 1:${sc1RR}.`,
      invalidation: `Закриття 15-хвилинної свічки за межами $${formatCryptoPrice(sc1SL)} скасовує структуру.`,
      rawSignalText: sc1RawSignal
    },
    {
      id: "momentum",
      name: `Агресивний (Моментум / Вхід ${sc2Side.toUpperCase()} по ринку)`,
      badge: "⚡ Швидкий Скальп",
      isRecommended: bestScenarioId === "momentum",
      orderType: "Market",
      side: sc2Side,
      entryPrice: sc2Entry,
      stopLoss: sc2SL,
      slDistancePct: sc2SLDistPct,
      tp1: sc2TP1,
      tp1DistancePct: sc2TP1DistPct,
      tp2: sc2TP2,
      tp2DistancePct: sc2TP2DistPct,
      tp3: sc2TP3,
      tp3DistancePct: sc2TP3DistPct,
      leverage: sc2Leverage,
      allocatedMarginUsdt: budget,
      notionalUsdt: sc2Notional,
      approxQty: sc2Qty,
      maxLossUsdt: sc2MaxLoss,
      targetGainUsdt: sc2TargetGain,
      riskRewardRatio: sc2RR,
      winProbabilityPct: null, // P0-01
      thesis: sc2Side === "short"
        ? `Миттєве відкриття SHORT по ринковій ціні $${formatCryptoPrice(sc2Entry)} для захоплення імпульсу падіння. Швидка фіксація TP1 (+${sc2TP1DistPct}%).`
        : `Миттєве відкриття LONG по ринковій ціні $${formatCryptoPrice(sc2Entry)} для захоплення поточного імпульсу. Перший тейк розрахований на швидкий скальп (+${sc2TP1DistPct}%).`,
      invalidation: `Пробій волатильного Stop Loss на $${formatCryptoPrice(sc2SL)}.`,
      rawSignalText: sc2RawSignal
    },
    {
      id: "deep_swing",
      name: isCounterTrend
        ? `Контртрендовий (${sc3Side.toUpperCase()} відскок / Хедж)`
        : `Безпечний Свінг (Глибокий ${sc3Side === "long" ? "ретест" : "відкат"})`,
      badge: isCounterTrend ? "🔄 Контртренд 3x" : "💎 Знижене плече",
      isRecommended: bestScenarioId === "deep_swing",
      orderType: "Limit",
      side: sc3Side,
      entryPrice: sc3Entry,
      stopLoss: sc3SL,
      slDistancePct: sc3SLDistPct,
      tp1: sc3TP1,
      tp1DistancePct: sc3TP1DistPct,
      tp2: sc3TP2,
      tp2DistancePct: sc3TP2DistPct,
      tp3: sc3TP3,
      tp3DistancePct: sc3TP3DistPct,
      leverage: sc3Leverage,
      allocatedMarginUsdt: budget,
      notionalUsdt: sc3Notional,
      approxQty: sc3Qty,
      maxLossUsdt: sc3MaxLoss,
      targetGainUsdt: sc3TargetGain,
      riskRewardRatio: sc3RR,
      winProbabilityPct: null, // P0-01
      thesis: isCounterTrend
        ? `Альтернативний сценарій ${sc3Side.toUpperCase()} на випадок екстремального зняття ліквідності / відскоку від підтримки $${formatCryptoPrice(sc3Entry)}. Плече знижено до ${sc3Leverage}x для мінімізації ризику проти основного руху.`
        : `Глибокий лімітний ордер на $${formatCryptoPrice(sc3Entry)} для збору ліквідності. Плече ${sc3Leverage}x.`,
      invalidation: `Злам ключового 4-годинного свінгу на $${formatCryptoPrice(sc3SL)}.`,
      rawSignalText: sc3RawSignal
    }
  ];

  return { scenarios, bestScenarioId };
}

export interface CopilotAnalystInput {
  query: string;
  userBalance?: number | undefined;
  openRouterApiKey?: string | undefined;
  openRouterModel?: string | undefined;
}

/**
 * Orchestrates full AI copilot analysis: token extraction, budget detection,
 * market telemetry ingestion, scenario modeling and intelligent synthesis.
 */
export async function analyzePairWithCopilot(input: CopilotAnalystInput): Promise<CopilotAnalystResult> {
  const detectedSymbol = extractTokenFromPrompt(input.query);
  const detectedBudget = extractBudgetFromPrompt(input.query, input.userBalance);

  // 1. Fetch real market telemetry
  const marketData = await fetchCopilotMarketData(detectedSymbol);

  // 2. Calculate 3 mathematically sound scenarios
  const { scenarios, bestScenarioId } = calculateCopilotScenarios(marketData, detectedBudget, input.query);
  const best = scenarios.find((s) => s.id === bestScenarioId) ?? scenarios[0]!;

  // 3. Attempt LLM generation via OpenRouter
  let aiMarkdown = "";
  try {
    const promptMessage = `User asked: "${input.query}"
Target Symbol: ${marketData.symbol}
Live Price: $${formatCryptoPrice(marketData.currentPrice)} (24h Change: ${marketData.price24hPcnt > 0 ? "+" : ""}${marketData.price24hPcnt}%, 24h High: $${formatCryptoPrice(marketData.high24h)}, 24h Low: $${formatCryptoPrice(marketData.low24h)})
Microstructure: OrderBook Imbalance: ${marketData.orderBookImbalancePct !== null ? `${marketData.orderBookImbalancePct}%` : "balanced"}, 15m Trend: ${marketData.trend15m}, 15m RSI: ${marketData.rsi15m}, Funding: ${marketData.fundingRatePct}%
User Capital / Budget: $${detectedBudget.toFixed(2)} USDT

Pre-computed Scenarios:
1. ${scenarios[0]!.name} (${scenarios[0]!.side.toUpperCase()} ${scenarios[0]!.orderType} @ $${formatCryptoPrice(scenarios[0]!.entryPrice)}, SL $${formatCryptoPrice(scenarios[0]!.stopLoss)} [-${scenarios[0]!.slDistancePct}%], TP1 $${formatCryptoPrice(scenarios[0]!.tp1)}, Lev ${scenarios[0]!.leverage}x, Max Loss $${scenarios[0]!.maxLossUsdt}, Gain $${scenarios[0]!.targetGainUsdt})
2. ${scenarios[1]!.name} (${scenarios[1]!.side.toUpperCase()} ${scenarios[1]!.orderType} @ $${formatCryptoPrice(scenarios[1]!.entryPrice)}, SL $${formatCryptoPrice(scenarios[1]!.stopLoss)} [-${scenarios[1]!.slDistancePct}%], TP1 $${formatCryptoPrice(scenarios[1]!.tp1)}, Lev ${scenarios[1]!.leverage}x, Max Loss $${scenarios[1]!.maxLossUsdt}, Gain $${scenarios[1]!.targetGainUsdt})
3. ${scenarios[2]!.name} (${scenarios[2]!.side.toUpperCase()} ${scenarios[2]!.orderType} @ $${formatCryptoPrice(scenarios[2]!.entryPrice)}, SL $${formatCryptoPrice(scenarios[2]!.stopLoss)} [-${scenarios[2]!.slDistancePct}%], TP1 $${formatCryptoPrice(scenarios[2]!.tp1)}, Lev ${scenarios[2]!.leverage}x, Max Loss $${scenarios[2]!.maxLossUsdt}, Gain $${scenarios[2]!.targetGainUsdt})

Recommended Winner by quantitative engine: ${best.name} (${best.badge})

TASK: Provide a professional, concise institutional trading briefing in Ukrainian.
If the asset dropped heavily (-5% to -15%), explain why SHORT is dominant and why buying the dip requires extreme caution and tight SL.
Compare the scenarios and explain why ${best.name} is recommended for $${detectedBudget.toFixed(2)} USDT. Markdown bullets, no fake winrates.`;

    const res = await callNemotron([
      {
        role: "system",
        content: "You are Vexqora AI Copilot, an institutional quantitative hedge-fund analyst specializing in Bybit perpetuals risk management and SMC entry optimization."
      },
      {
        role: "user",
        content: promptMessage
      }
    ], {
      apiKey: input.openRouterApiKey,
      ...(input.openRouterModel ? { model: input.openRouterModel } : {}),
      maxTokens: 350
    });

    if (res?.content && res.content.trim().length > 50) {
      aiMarkdown = res.content.trim();
    }
  } catch {
    // fallback to analytical synthesis below
  }

  // 4. Deterministic Analytical Fallback if LLM is offline or out of tokens
  if (!aiMarkdown) {
    const isBearish24h = marketData.price24hPcnt < -2.0;
    const isBullish24h = marketData.price24hPcnt > 2.0;
    const directionDesc = isBearish24h
      ? `Спадний тиск (24h: ${marketData.price24hPcnt}%, ціна біля денних мінімумів). Пріоритет за спадними сценаріями (SHORT).`
      : isBullish24h
      ? `Висхідний імпульс (24h: +${marketData.price24hPcnt}%). Пріоритет за трендовими покупками (LONG).`
      : `Нейтральна консолідація (24h: ${marketData.price24hPcnt}%).`;

    aiMarkdown = `### 📊 Інституційний аналіз ${marketData.symbol}

• **Поточний стан ринку:** Ціна торгується на рівні **$${formatCryptoPrice(marketData.currentPrice)}** (${directionDesc}). Денний діапазон: [$${formatCryptoPrice(marketData.low24h)} - $${formatCryptoPrice(marketData.high24h)}].
• **Мікроструктура та стакан:** Order Book Imbalance: **${marketData.orderBookImbalancePct !== null ? `${marketData.orderBookImbalancePct}%` : "Нейтральний"}**, RSI (15M): **${marketData.rsi15m}/100**, Фандинг: **${marketData.fundingRatePct}%**.
• **Рекомендований план входу:** Для виділеного депозиту **$${detectedBudget.toFixed(2)} USDT** оптимальним є **${best.name}** (${best.side.toUpperCase()} ${best.orderType}).
• **Оцінка альтернатив:** Якщо ринок покаже розворотну реакцію — для балансу розраховано сценарій **${scenarios[2]!.name}** (${scenarios[2]!.side.toUpperCase()}) зі зниженим плечем ${scenarios[2]!.leverage}x для контролю ризику.
• **Правило захисту:** При досягненні TP1 (+${best.tp1DistancePct}%) перенесіть Stop Loss на рівень точки входу ($${formatCryptoPrice(best.entryPrice)}).`;
  }

  return {
    query: input.query,
    detectedSymbol,
    detectedBudget,
    marketData,
    aiAnalysis: {
      title: `Аналіз ${detectedSymbol} для капіталу $${detectedBudget.toFixed(2)} USDT`,
      marketConditionSummary: `Ціна: $${formatCryptoPrice(marketData.currentPrice)} (${marketData.price24hPcnt >= 0 ? "+" : ""}${marketData.price24hPcnt}%). Режим: ${marketData.trend15m.toUpperCase()}, RSI: ${marketData.rsi15m}.`,
      orderFlowObservation: `Стакан OBI: ${marketData.orderBookImbalancePct ?? 0}%, Фандинг: ${marketData.fundingRatePct}%.`,
      bestScenarioId,
      recommendationReason: `Сценарій ${best.name} забезпечує математичний R:R 1:${best.riskRewardRatio} з контрольованим максимальним збитком $${best.maxLossUsdt} USDT.`,
      keyRiskWarnings: [
        `Максимальний ризик при спрацюванні SL: $${best.maxLossUsdt} USDT (${best.slDistancePct}% від ціни входу).`,
        "Переведення SL у беззбиток після закриття першого тейку є обов'язковим."
      ],
      actionSteps: [
        `Натисніть кнопку під сценарієм "${best.name}" для відкриття позиції.`,
        "Слідкуйте за супроводом позиції в торговому терміналі Vexqora Companion."
      ],
      fullMarkdownText: aiMarkdown
    },
    scenarios
  };
}
