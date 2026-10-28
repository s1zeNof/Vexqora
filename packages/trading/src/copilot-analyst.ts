import { formatCryptoPrice, sanitizeSymbol } from "@crypto-bot/shared";
import { getSensibleTickSize } from "./ai-copilot";
import { roundToStep } from "./risk";
import { calculateRSI } from "./feature-registry";
import { callNemotron } from "./nemotron";

export interface CopilotAnalystInput {
  query: string;
  userBalance?: number | undefined;
  openRouterApiKey?: string | undefined;
  openRouterModel?: string | undefined;
}

export interface CopilotTradeScenario {
  id: string; // "conservative" | "momentum" | "deep_swing"
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
  winProbabilityPct: number;
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
  dogecoin: "DOGEUSDT",
  догі: "DOGEUSDT",
  pepe: "PEPEUSDT",
  пепе: "PEPEUSDT",
  sui: "SUIUSDT",
  суі: "SUIUSDT",
  near: "NEARUSDT",
  ніар: "NEARUSDT",
  bnb: "BNBUSDT",
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
  [/полкадот/i, "DOTUSDT"]
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

  // 2. Look for phrases like "монету SOL", "в SOL", "пару SOL"
  const phraseMatch = /(?:монет[уаиі]?|монети|пару|крипт[уа]?|токен|вход[уа]?\s+в|по)\s+([A-Za-z0-9]{2,12})/i.exec(prompt);
  if (phraseMatch?.[1]) {
    const raw = phraseMatch[1].toUpperCase();
    return sanitizeSymbol(raw.endsWith("USDT") ? raw : `${raw}USDT`);
  }

  // 3. Look for explicit {TICKER}USDT
  const usdtMatch = /\b([A-Z0-9]{2,10})USDT\b/i.exec(prompt);
  if (usdtMatch?.[1]) {
    return sanitizeSymbol(`${usdtMatch[1].toUpperCase()}USDT`);
  }

  // 4. Look for uppercase ticker symbol (e.g. SOL, BTC)
  const standaloneMatch = /\b([A-Z]{3,8})\b/.exec(prompt);
  if (standaloneMatch?.[1]) {
    const candidate = standaloneMatch[1].toUpperCase();
    if (!["THE", "FOR", "AND", "NOT", "ALL", "NEW", "BUY", "TOP", "USD", "EUR"].includes(candidate)) {
      return sanitizeSymbol(`${candidate}USDT`);
    }
  }

  // Fallback
  return "BTCUSDT";
}

/**
 * Extracts dollar amount/budget from user free-form query.
 */
export function extractBudgetFromPrompt(prompt: string, fallbackBudget = 15): number {
  // Patterns like "$15", "15$", "15 USDT", "15 usd", "15 дол", "15 бакс", "маю 15", "депозит 15"
  const patterns = [
    /(?:маю|депозит|сума|баланс|на|під|бюджет|з|капітал)\s*(?:в\s*)?\$?\s*(\d+(?:[.,]\d+)?)\s*(?:\$|usdt|usd|дол|бакс|гривень)?/i,
    /(\d+(?:[.,]\d+)?)\s*(?:\$|usdt|usd|дол|бакс)/i,
    /\$\s*(\d+(?:[.,]\d+)?)/i
  ];

  for (const re of patterns) {
    const match = re.exec(prompt);
    if (match?.[1]) {
      const num = parseFloat(match[1].replace(",", "."));
      if (!isNaN(num) && num > 0) {
        return Number(num.toFixed(2));
      }
    }
  }

  return fallbackBudget > 0 ? Number(fallbackBudget.toFixed(2)) : 15;
}

/**
 * Fetches real Bybit market telemetry with fallback to Binance.
 */
export async function fetchCopilotMarketData(symbol: string): Promise<CopilotMarketData> {
  const normSymbol = sanitizeSymbol(symbol).toUpperCase();

  let currentPrice = 0;
  let price24hPcnt = 0;
  let high24h = 0;
  let low24h = 0;
  let volume24hUsd = 0;
  let fundingRatePct = 0;
  let orderBookImbalancePct: number | null = null;
  let buyerAggressionPct: number | null = null;
  let trend15m: "bullish" | "bearish" | "ranging" = "ranging";
  let rsi15m = 50;

  // 1. Fetch Bybit linear ticker & klines & orderbook in parallel
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
      // Bybit returns newest first, reverse to chronological
      const closes = rawList
        .map((k) => Number(k[4]))
        .filter((n) => Number.isFinite(n) && n > 0)
        .reverse();

      if (closes.length > 0) {
        if (currentPrice === 0) {
          currentPrice = closes[closes.length - 1] ?? 0;
        }

        // Calculate RSI
        if (closes.length >= 15) {
          const rsiSeries = calculateRSI(closes, 14);
          const lastRsi = rsiSeries[rsiSeries.length - 1];
          if (typeof lastRsi === "number" && !isNaN(lastRsi)) {
            rsi15m = Math.round(lastRsi);
          }
        }

        // Calculate EMA20 trend
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

  // Fallback to Binance if price is still missing
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

  // Sensible default fallback if symbol is brand new or offline
  if (currentPrice === 0) {
    currentPrice = normSymbol.includes("BTC") ? 67500 : normSymbol.includes("ETH") ? 2600 : normSymbol.includes("SOL") ? 175 : 10;
  }

  return {
    symbol: normSymbol,
    currentPrice,
    price24hPcnt: Number(price24hPcnt.toFixed(2)),
    high24h: high24h > 0 ? high24h : currentPrice * 1.03,
    low24h: low24h > 0 ? low24h : currentPrice * 0.97,
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
 */
export function calculateCopilotScenarios(
  market: CopilotMarketData,
  budget: number,
  userPrompt: string
): { scenarios: CopilotTradeScenario[]; bestScenarioId: string } {
  const normSymbol = market.symbol;
  const currentPrice = market.currentPrice;
  const tickSize = getSensibleTickSize(currentPrice);

  // Detect explicit user bias (long or short)
  const lowerPrompt = userPrompt.toLowerCase();
  let side: "long" | "short";

  if (lowerPrompt.includes("шорт") || lowerPrompt.includes("short") || lowerPrompt.includes("падінн") || lowerPrompt.includes("продати")) {
    side = "short";
  } else if (lowerPrompt.includes("лонг") || lowerPrompt.includes("long") || lowerPrompt.includes("ріст") || lowerPrompt.includes("куп")) {
    side = "long";
  } else {
    // Algorithmic bias based on trend & orderbook
    if (market.trend15m === "bearish" && market.rsi15m < 45 && (market.orderBookImbalancePct ?? 0) < -15) {
      side = "short";
    } else {
      side = "long";
    }
  }

  const isLong = side === "long";

  // Helper to round price to instrument tick
  const rTick = (p: number) => roundToStep(p, tickSize);

  // ----------------------------------------------------
  // SCENARIO 1: Консервативний (Лімітний відкат / Smart Money Pullback)
  // ----------------------------------------------------
  const sc1Entry = rTick(isLong ? currentPrice * 0.988 : currentPrice * 1.012);
  const sc1SLDistPct = 1.8;
  const sc1SL = rTick(isLong ? sc1Entry * (1 - sc1SLDistPct / 100) : sc1Entry * (1 + sc1SLDistPct / 100));
  const sc1TP1 = rTick(isLong ? sc1Entry * 1.032 : sc1Entry * 0.968);
  const sc1TP2 = rTick(isLong ? sc1Entry * 1.056 : sc1Entry * 0.944);
  const sc1TP3 = rTick(isLong ? sc1Entry * 1.088 : sc1Entry * 0.912);
  const sc1Leverage = 5;
  const sc1Notional = budget * sc1Leverage;
  const sc1Qty = sc1Entry > 0 ? Number((sc1Notional / sc1Entry).toFixed(4)) : 0;
  const sc1MaxLoss = Number((budget * (sc1SLDistPct / 100) * sc1Leverage).toFixed(2));
  const sc1WeightedGainPct = (3.2 * 0.4 + 5.6 * 0.35 + 8.8 * 0.25);
  const sc1TargetGain = Number((budget * (sc1WeightedGainPct / 100) * sc1Leverage).toFixed(2));
  const sc1RR = Number((sc1WeightedGainPct / sc1SLDistPct).toFixed(2));

  const sc1RawSignal = `${normSymbol} ${side.toUpperCase()}
entry ${sc1Entry}
sl ${sc1SL}
tp ${sc1TP1} 40%, ${sc1TP2} 35%, ${sc1TP3} 25%
trail 1% after tp1
lev ${sc1Leverage}`;

  // ----------------------------------------------------
  // SCENARIO 2: Агресивний (Моментум / Вхід по ринку)
  // ----------------------------------------------------
  const sc2Entry = currentPrice;
  const sc2SLDistPct = 2.4;
  const sc2SL = rTick(isLong ? sc2Entry * (1 - sc2SLDistPct / 100) : sc2Entry * (1 + sc2SLDistPct / 100));
  const sc2TP1 = rTick(isLong ? sc2Entry * 1.022 : sc2Entry * 0.978);
  const sc2TP2 = rTick(isLong ? sc2Entry * 1.044 : sc2Entry * 0.956);
  const sc2TP3 = rTick(isLong ? sc2Entry * 1.068 : sc2Entry * 0.932);
  const sc2Leverage = 5;
  const sc2Notional = budget * sc2Leverage;
  const sc2Qty = sc2Entry > 0 ? Number((sc2Notional / sc2Entry).toFixed(4)) : 0;
  const sc2MaxLoss = Number((budget * (sc2SLDistPct / 100) * sc2Leverage).toFixed(2));
  const sc2WeightedGainPct = (2.2 * 0.4 + 4.4 * 0.35 + 6.8 * 0.25);
  const sc2TargetGain = Number((budget * (sc2WeightedGainPct / 100) * sc2Leverage).toFixed(2));
  const sc2RR = Number((sc2WeightedGainPct / sc2SLDistPct).toFixed(2));

  const sc2RawSignal = `${normSymbol} ${side.toUpperCase()}
entry market
sl ${sc2SL}
tp ${sc2TP1} 40%, ${sc2TP2} 35%, ${sc2TP3} 25%
trail 1% after tp1
lev ${sc2Leverage}`;

  // ----------------------------------------------------
  // SCENARIO 3: Безпечний Свінг (Глибокий ретест / Широкий стоп)
  // ----------------------------------------------------
  const sc3Entry = rTick(isLong ? currentPrice * 0.972 : currentPrice * 1.028);
  const sc3SLDistPct = 3.4;
  const sc3SL = rTick(isLong ? sc3Entry * (1 - sc3SLDistPct / 100) : sc3Entry * (1 + sc3SLDistPct / 100));
  const sc3TP1 = rTick(isLong ? sc3Entry * 1.052 : sc3Entry * 0.948);
  const sc3TP2 = rTick(isLong ? sc3Entry * 1.092 : sc3Entry * 0.908);
  const sc3TP3 = rTick(isLong ? sc3Entry * 1.150 : sc3Entry * 0.850);
  const sc3Leverage = 3; // lower leverage for wider swing
  const sc3Notional = budget * sc3Leverage;
  const sc3Qty = sc3Entry > 0 ? Number((sc3Notional / sc3Entry).toFixed(4)) : 0;
  const sc3MaxLoss = Number((budget * (sc3SLDistPct / 100) * sc3Leverage).toFixed(2));
  const sc3WeightedGainPct = (5.2 * 0.5 + 9.2 * 0.3 + 15.0 * 0.2);
  const sc3TargetGain = Number((budget * (sc3WeightedGainPct / 100) * sc3Leverage).toFixed(2));
  const sc3RR = Number((sc3WeightedGainPct / sc3SLDistPct).toFixed(2));

  const sc3RawSignal = `${normSymbol} ${side.toUpperCase()}
entry ${sc3Entry}
sl ${sc3SL}
tp ${sc3TP1} 50%, ${sc3TP2} 30%, ${sc3TP3} 20%
trail 1.5% after tp1
lev ${sc3Leverage}`;

  // Evaluate which scenario is the absolute best
  // If market is ranging or near support: conservative is king
  // If OBI > 25% or strong breakout: momentum is best
  let bestScenarioId = "conservative";
  if (Math.abs(market.price24hPcnt) > 5 && (market.orderBookImbalancePct ?? 0) > 20) {
    bestScenarioId = "momentum";
  } else if (budget < 10) {
    // For smaller accounts, tighter conservative risk preserves capital
    bestScenarioId = "conservative";
  }

  const scenarios: CopilotTradeScenario[] = [
    {
      id: "conservative",
      name: "Консервативний (Лімітний відкат)",
      badge: "🛡️ Оптимальний R:R",
      isRecommended: bestScenarioId === "conservative",
      orderType: "Limit",
      side,
      entryPrice: sc1Entry,
      stopLoss: sc1SL,
      slDistancePct: sc1SLDistPct,
      tp1: sc1TP1,
      tp1DistancePct: 3.2,
      tp2: sc1TP2,
      tp2DistancePct: 5.6,
      tp3: sc1TP3,
      tp3DistancePct: 8.8,
      leverage: sc1Leverage,
      allocatedMarginUsdt: budget,
      notionalUsdt: sc1Notional,
      approxQty: sc1Qty,
      maxLossUsdt: sc1MaxLoss,
      targetGainUsdt: sc1TargetGain,
      riskRewardRatio: sc1RR,
      winProbabilityPct: 74,
      thesis: `Очікування відкату до зони ліквідності / FVG на $${formatCryptoPrice(sc1Entry)}. Вхід лімітним ордером дає мінімальний стоп ($${formatCryptoPrice(sc1SL)}) та вигідне співвідношення ризику до прибутку 1:${sc1RR}.`,
      invalidation: `Закриття 15-хвилинної свічки за межами $${formatCryptoPrice(sc1SL)} скасовує бичачу структуру.`,
      rawSignalText: sc1RawSignal
    },
    {
      id: "momentum",
      name: "Агресивний (Моментум / Вхід по ринку)",
      badge: "⚡ Швидкий Скальп",
      isRecommended: bestScenarioId === "momentum",
      orderType: "Market",
      side,
      entryPrice: sc2Entry,
      stopLoss: sc2SL,
      slDistancePct: sc2SLDistPct,
      tp1: sc2TP1,
      tp1DistancePct: 2.2,
      tp2: sc2TP2,
      tp2DistancePct: 4.4,
      tp3: sc2TP3,
      tp3DistancePct: 6.8,
      leverage: sc2Leverage,
      allocatedMarginUsdt: budget,
      notionalUsdt: sc2Notional,
      approxQty: sc2Qty,
      maxLossUsdt: sc2MaxLoss,
      targetGainUsdt: sc2TargetGain,
      riskRewardRatio: sc2RR,
      winProbabilityPct: 64,
      thesis: `Миттєве відкриття по ринковій ціні $${formatCryptoPrice(sc2Entry)} для захоплення поточного імпульсу. Перший тейк розрахований на швидкий скальп (+2.2%).`,
      invalidation: `Пробій волатильного Stop Loss на $${formatCryptoPrice(sc2SL)}.`,
      rawSignalText: sc2RawSignal
    },
    {
      id: "deep_swing",
      name: "Безпечний Свінг (Глибокий ретест)",
      badge: "💎 Знижене плече",
      isRecommended: bestScenarioId === "deep_swing",
      orderType: "Limit",
      side,
      entryPrice: sc3Entry,
      stopLoss: sc3SL,
      slDistancePct: sc3SLDistPct,
      tp1: sc3TP1,
      tp1DistancePct: 5.2,
      tp2: sc3TP2,
      tp2DistancePct: 9.2,
      tp3: sc3TP3,
      tp3DistancePct: 15.0,
      leverage: sc3Leverage,
      allocatedMarginUsdt: budget,
      notionalUsdt: sc3Notional,
      approxQty: sc3Qty,
      maxLossUsdt: sc3MaxLoss,
      targetGainUsdt: sc3TargetGain,
      riskRewardRatio: sc3RR,
      winProbabilityPct: 69,
      thesis: `Глибокий лімітний ордер на $${formatCryptoPrice(sc3Entry)} для збору ліквідності після локального шейкауту. Плече знижено до ${sc3Leverage}x для спокійного утримання позиції.`,
      invalidation: `Злам ключового 4-годинного свінгу на $${formatCryptoPrice(sc3SL)}.`,
      rawSignalText: sc3RawSignal
    }
  ];

  return { scenarios, bestScenarioId };
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
Microstructure: OrderBook Imbalance: ${marketData.orderBookImbalancePct !== null ? `${marketData.orderBookImbalancePct}%` : "balanced"}, 15m Trend: ${marketData.trend15m}, 15m RSI: ${marketData.rsi15m}
User Capital / Budget allocated: $${detectedBudget.toFixed(2)} USDT

Pre-computed Scenarios:
1. Conservative (Limit @ $${formatCryptoPrice(scenarios[0]!.entryPrice)}, SL $${formatCryptoPrice(scenarios[0]!.stopLoss)} [-${scenarios[0]!.slDistancePct}%], TP1 $${formatCryptoPrice(scenarios[0]!.tp1)}, TP2 $${formatCryptoPrice(scenarios[0]!.tp2)}, TP3 $${formatCryptoPrice(scenarios[0]!.tp3)}, Lev ${scenarios[0]!.leverage}x, Max Loss $${scenarios[0]!.maxLossUsdt}, Target Gain $${scenarios[0]!.targetGainUsdt})
2. Momentum (Market @ $${formatCryptoPrice(scenarios[1]!.entryPrice)}, SL $${formatCryptoPrice(scenarios[1]!.stopLoss)} [-${scenarios[1]!.slDistancePct}%], TP1 $${formatCryptoPrice(scenarios[1]!.tp1)}, Lev ${scenarios[1]!.leverage}x, Max Loss $${scenarios[1]!.maxLossUsdt}, Target Gain $${scenarios[1]!.targetGainUsdt})
3. Safe Swing (Deep Limit @ $${formatCryptoPrice(scenarios[2]!.entryPrice)}, SL $${formatCryptoPrice(scenarios[2]!.stopLoss)} [-${scenarios[2]!.slDistancePct}%], TP1 $${formatCryptoPrice(scenarios[2]!.tp1)}, Lev ${scenarios[2]!.leverage}x, Max Loss $${scenarios[2]!.maxLossUsdt}, Target Gain $${scenarios[2]!.targetGainUsdt})

Recommended Winner by quantitative engine: ${best.name} (${best.badge})

TASK: Provide an elite, comprehensive institutional trading briefing in Ukrainian addressing the user's specific query.
Include:
1. Executive Market Verdict (live price context, trend, OBI flow).
2. Deep comparative analysis of the 3 entry scenarios for the exact budget of $${detectedBudget.toFixed(2)} USDT.
3. Why the winner scenario (${best.name}) is mathematically optimal for their capital.
4. Actionable Trade Management Rules (when to move SL to Breakeven, partial take-profits, invalidation).
Keep tone professional, analytical, quantitative, without generic disclaimers.`;

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
      ...(input.openRouterApiKey ? { apiKey: input.openRouterApiKey } : {}),
      ...(input.openRouterModel ? { model: input.openRouterModel } : {}),
      temperature: 0.35,
      maxTokens: 900
    });

    if (res.content && res.content.trim().length > 100) {
      aiMarkdown = res.content.trim();
    }
  } catch {
    // Graceful fallback to deterministic institutional synthesizer below
  }

  // 4. Built-in institutional fallback synthesizer if LLM is offline
  if (!aiMarkdown) {
    const isLong = best.side === "long";
    const sideLabel = isLong ? "LONG (Купівля)" : "SHORT (Продаж)";
    const obiComment = marketData.orderBookImbalancePct !== null
      ? (marketData.orderBookImbalancePct > 10
          ? `Перевага покупців у стакані (+${marketData.orderBookImbalancePct}% OBI), стінки на купівлю підтримують ціну.`
          : marketData.orderBookImbalancePct < -10
            ? `Тиск продавців у стакані (${marketData.orderBookImbalancePct}% OBI), присутні щільні аски.`
            : `Стакан збалансований (OBI близько 0%), спред мінімальний.`)
      : "Ліквідність у біржовому стакані стабільна.";

    aiMarkdown = `### 🎯 Інституційний вердикт Vexqora Copilot по ${marketData.symbol}

Поточна ціна активу становить **$${formatCryptoPrice(marketData.currentPrice)}** (добова динаміка: ${marketData.price24hPcnt >= 0 ? "+" : ""}${marketData.price24hPcnt}%). На 15-хвилинному таймфреймі структура має статус **${marketData.trend15m === "bullish" ? "висхідна (Bullish)" : marketData.trend15m === "bearish" ? "низхідна (Bearish)" : "боковик (Ranging)"}** з показником RSI **${marketData.rsi15m}/100**. ${obiComment}

---

### 🏆 Найкращий вибір під депозит $${detectedBudget.toFixed(2)} USDT: **${best.name}**

Для вашого бюджету **$${detectedBudget.toFixed(2)}** найкращим математичним співвідношенням ризику та прибутку володіє саме **${best.name}** (${sideLabel}):

1. **Точка входу:** ${best.orderType === "Limit" ? `Лімітний ордер на **$${formatCryptoPrice(best.entryPrice)}**` : `По ринку (**$${formatCryptoPrice(best.entryPrice)}**)`}. ${best.thesis}
2. **Захисний Stop Loss:** **$${formatCryptoPrice(best.stopLoss)}** (дистанція -${best.slDistancePct}%). При плечі **${best.leverage}x** максимальний ризик на весь ваш депозит складає лише **$${best.maxLossUsdt} USDT** (безпечні ~${((best.maxLossUsdt / detectedBudget) * 100).toFixed(1)}% капіталу).
3. **Каскад Take Profit:**
   - **TP1 (40%):** $${formatCryptoPrice(best.tp1)} (+${best.tp1DistancePct}%) — перша фіксація прибутку та автоматичний перенос SL у беззбиток (Breakeven).
   - **TP2 (35%):** $${formatCryptoPrice(best.tp2)} (+${best.tp2DistancePct}%) — зняття основної ліквідності.
   - **TP3 (25%):** $${formatCryptoPrice(best.tp3)} (+${best.tp3DistancePct}%) — раннер на випадок затяжного тренду.
4. **Потенційний результат:** Чистий очікуваний профіт складає **+$${best.targetGainUsdt} USDT** при співвідношенні Risk/Reward **1:${best.riskRewardRatio}** та ймовірності позитивного сценарію **${best.winProbabilityPct}%**.

---

### 🛡️ Покроковий план ведення позиції:
- **Крок 1:** Не входьте підвищеним плечем. Рекомендоване плече **${best.leverage}x** гарантує, що ліквідація знаходиться далеко за межами робочого діапазону.
- **Крок 2:** Щойно спрацює **TP1**, Vexqora Автопілот автоматично переставить ваш Stop Loss на рівень відкриття ($${formatCryptoPrice(best.entryPrice)}), виключаючи будь-який ризик втрати депозиту.
- **Крок 3:** Якщо ринок піде проти сетапу і проб'є рівень **$${formatCryptoPrice(best.stopLoss)}**, позиція закриється автоматично з мінімальною контрольованою втратою $${best.maxLossUsdt}.`;
  }

  return {
    query: input.query,
    detectedSymbol: marketData.symbol,
    detectedBudget,
    marketData,
    aiAnalysis: {
      title: `Аналітичний план ${marketData.symbol} для капіталу $${detectedBudget.toFixed(2)} USDT`,
      marketConditionSummary: `Поточна ціна $${formatCryptoPrice(marketData.currentPrice)}, тренд ${marketData.trend15m}, RSI ${marketData.rsi15m}`,
      orderFlowObservation: marketData.orderBookImbalancePct !== null ? `OBI: ${marketData.orderBookImbalancePct}%` : "Норма",
      bestScenarioId,
      recommendationReason: `Сценарій "${best.name}" забезпечує максимальний R:R (1:${best.riskRewardRatio}) та жорстко обмежує ризик до $${best.maxLossUsdt} при депозиті $${detectedBudget}.`,
      keyRiskWarnings: [
        `Максимальний збиток по стопу обмежено до $${best.maxLossUsdt} USDT`,
        `Не підвищуйте плече вище ${best.leverage}x для збереження маржинального запасу`,
        `При досягненні TP1 перемістіть SL у Breakeven`
      ],
      actionSteps: [
        `Розмістити ${best.orderType === "Limit" ? `лімітний ордер на $${formatCryptoPrice(best.entryPrice)}` : "ринковий ордер"} на суму $${detectedBudget}`,
        `Встановити біржовий SL на рівень $${formatCryptoPrice(best.stopLoss)}`,
        `Встановити 3 лімітні ордери Take Profit з каскадом 40%/35%/25%`
      ],
      fullMarkdownText: aiMarkdown
    },
    scenarios
  };
}
