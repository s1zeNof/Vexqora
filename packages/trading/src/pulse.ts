import { findHistoricalPatternMatch, type HistoricalPatternMatch } from "./memory";
import type { MarketMicrostructure } from "./microstructure";

export interface BybitTickerItem {
  symbol: string;
  lastPrice: string;
  highPrice24h?: string;
  lowPrice24h?: string;
  turnover24h?: string;
}

export interface MarketPulseAnomaly {
  id: string;
  symbol: string;
  exchange: "bybit" | "binance";
  eventType:
    | "price_spike"
    | "price_dump"
    | "volume_spike"
    | "liquidity_sweep"
    | "whale_accumulation"
    | "whale_distribution"
    | "short_squeeze"
    | "long_flush"
    | "orderbook_imbalance";
  changePct: number;
  timeframeSec: number;
  price: number;
  turnover24h: number;
  aiStatus: "monitoring" | "evaluating" | "signal_generated" | "no_trade";
  rationale: string;
  historicalMatch: HistoricalPatternMatch;
  microstructure?: MarketMicrostructure | undefined;
  timestamp: number;
}

export class VexqoraPulseScanner {
  private priceSnapshot = new Map<string, { price: number; timestamp: number }>();

  public processTickers(
    tickers: BybitTickerItem[],
    now: number = Date.now()
  ): MarketPulseAnomaly[] {
    const anomalies: MarketPulseAnomaly[] = [];

    for (const item of tickers) {
      const price = Number(item.lastPrice);
      const turnover = Number(item.turnover24h ?? 0);
      if (!price || isNaN(price)) continue;

      // Filter out micro-cap dust (< 500k 24h turnover)
      if (turnover < 500_000) continue;

      const prev = this.priceSnapshot.get(item.symbol);
      this.priceSnapshot.set(item.symbol, { price, timestamp: now });

      if (prev) {
        const timeDeltaSec = Math.max(1, Math.round((now - prev.timestamp) / 1000));
        // Only evaluate if time delta is between 5s and 60s
        if (timeDeltaSec >= 5 && timeDeltaSec <= 60) {
          const changePct = Number((((price - prev.price) / prev.price) * 100).toFixed(2));
          const absChange = Math.abs(changePct);

          // Adaptive impulse threshold:
          // For high-turnover liquid coins (turnover >= $30M, e.g. SOL, BTC, ETH, LINK, PEPE, SUI, NEAR),
          // a 0.70% impulse in 5-60s represents substantial whale tape absorption/sweep.
          // For mid turnover ($10M-$30M), threshold is 1.10%.
          // For lower turnover, threshold is 1.80%.
          const minImpulse = turnover >= 30_000_000 ? 0.70 : turnover >= 10_000_000 ? 1.10 : 1.80;

          if (absChange >= minImpulse) {
            const isWhaleImpulse = turnover >= 20_000_000;
            const eventType: MarketPulseAnomaly["eventType"] = isWhaleImpulse
              ? (changePct > 0 ? "whale_accumulation" : "whale_distribution")
              : (changePct > 0 ? "price_spike" : "price_dump");
            const hist = findHistoricalPatternMatch(item.symbol, eventType, changePct);

            anomalies.push({
              id: `pulse-${item.symbol}-${now}`,
              symbol: item.symbol,
              exchange: "bybit",
              eventType,
              changePct,
              timeframeSec: timeDeltaSec,
              price,
              turnover24h: turnover,
              aiStatus: (absChange >= 2.5 || (isWhaleImpulse && absChange >= 1.0)) ? "evaluating" : "monitoring",
              rationale: `${item.symbol} registered a rapid ${changePct > 0 ? "+" : ""}${changePct}% price impulse across ${timeDeltaSec}s on Bybit USDT perpetuals (${isWhaleImpulse ? "Whale Order Flow" : "Momentum"}).`,
              historicalMatch: hist,
              timestamp: now
            });
          }
        }
      }
    }

    return anomalies;
  }
}

export type UniverseScanFilter = "balanced" | "moderate" | "momentum" | "volatile";

export interface UniverseMarketOpportunity {
  symbol: string;
  lastPrice: number;
  change24hPct: number;
  turnover24h: number;
  anomalyType: "volume_breakout" | "volatility_expansion" | "liquidity_hunt";
  category?: "moderate" | "momentum" | "volatile" | undefined;
}

export function selectUniverseOpportunities(
  candidates: UniverseMarketOpportunity[],
  limit: number = 6,
  filter: UniverseScanFilter = "balanced"
): UniverseMarketOpportunity[] {
  if (candidates.length === 0) return [];

  // 1. Moderate pool: steady market structure (-5.0% to +5.0%)
  // Sorted strictly by turnover24h descending: brings top liquid Bybit coins
  // (SOL, DOGE, AVAX, NEAR, SUI, LINK, PEPE, UNI, SUSHI, etc.) to the top!
  const moderatePool = candidates
    .filter((c) => Math.abs(c.change24hPct) <= 5.0)
    .sort((a, b) => b.turnover24h - a.turnover24h);

  // 2. Momentum pool: healthy trending coins (5.0% to 15.0%)
  const momentumPool = candidates
    .filter((c) => Math.abs(c.change24hPct) > 5.0 && Math.abs(c.change24hPct) <= 15.0)
    .sort((a, b) => b.turnover24h - a.turnover24h);

  // 3. Volatile pool: extreme movers (> 15.0%)
  const volatilePool = candidates
    .filter((c) => Math.abs(c.change24hPct) > 15.0)
    .sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct));

  if (filter === "moderate") {
    const selected = [...moderatePool];
    if (selected.length < limit) selected.push(...momentumPool);
    if (selected.length < limit) selected.push(...volatilePool);
    return selected.slice(0, limit);
  }

  if (filter === "momentum") {
    const selected = [...momentumPool];
    if (selected.length < limit) selected.push(...moderatePool);
    if (selected.length < limit) selected.push(...volatilePool);
    return selected.slice(0, limit);
  }

  if (filter === "volatile") {
    const selected = [...volatilePool];
    if (selected.length < limit) selected.push(...momentumPool);
    if (selected.length < limit) selected.push(...moderatePool);
    return selected.slice(0, limit);
  }

  // "balanced" mode (DEFAULT):
  // Gives majority (~55-60%) representation to moderate (-5%..+5%) liquid pairs,
  // accompanied by high-conviction momentum setups and a small slice of high volatility.
  let moderateQuota = Math.max(1, Math.min(moderatePool.length, Math.round(limit * 0.58)));
  if (limit === 3) moderateQuota = 2;
  if (limit === 2) moderateQuota = 1;
  if (limit === 1) moderateQuota = 1;

  const remainingAfterModerate = limit - moderateQuota;
  const momentumQuota = Math.min(momentumPool.length, Math.max(0, Math.ceil(remainingAfterModerate * 0.6)));
  const volatileQuota = Math.min(volatilePool.length, Math.max(0, limit - moderateQuota - momentumQuota));

  const result: UniverseMarketOpportunity[] = [];
  const addedSymbols = new Set<string>();

  const addFrom = (pool: UniverseMarketOpportunity[], count: number) => {
    let added = 0;
    for (const item of pool) {
      if (added >= count) break;
      if (!addedSymbols.has(item.symbol)) {
        addedSymbols.add(item.symbol);
        result.push(item);
        added++;
      }
    }
  };

  addFrom(moderatePool, moderateQuota);
  addFrom(momentumPool, momentumQuota);
  addFrom(volatilePool, volatileQuota);

  // Backfill if any pool had fewer items than its quota
  if (result.length < limit) addFrom(moderatePool, limit - result.length);
  if (result.length < limit) addFrom(momentumPool, limit - result.length);
  if (result.length < limit) addFrom(volatilePool, limit - result.length);

  return result.slice(0, limit);
}

export async function fetchTopUniverseOpportunities(
  limit: number = 6,
  customFetch: typeof fetch = fetch,
  filter: UniverseScanFilter = "balanced"
): Promise<UniverseMarketOpportunity[]> {
  // 1. Try Bybit Linear tickers
  try {
    const res = await customFetch("https://api.bybit.com/v5/market/tickers?category=linear", {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json"
      }
    });
    if (res.ok) {
      const data = (await res.json()) as {
        result?: {
          list?: Array<{ symbol: string; lastPrice: string; price24hPcnt: string; turnover24h: string }>;
        };
      };
      const list = data.result?.list ?? [];
      if (list.length > 0) {
        const candidates: UniverseMarketOpportunity[] = list
          .filter((t) => t.symbol.endsWith("USDT") && Number(t.turnover24h) >= 5_000_000)
          .map((t) => {
            const changePct = Number(t.price24hPcnt) * 100;
            const turnover = Number(t.turnover24h);
            const absChange = Math.abs(changePct);
            const category: UniverseMarketOpportunity["category"] =
              absChange <= 5.0 ? "moderate" : absChange <= 15.0 ? "momentum" : "volatile";
            const anomalyType: UniverseMarketOpportunity["anomalyType"] =
              category === "volatile"
                ? "volatility_expansion"
                : turnover >= 40_000_000
                  ? "volume_breakout"
                  : "liquidity_hunt";
            return {
              symbol: t.symbol,
              lastPrice: Number(t.lastPrice),
              change24hPct: Number(changePct.toFixed(2)),
              turnover24h: turnover,
              anomalyType,
              category
            };
          });

        const selected = selectUniverseOpportunities(candidates, limit, filter);
        if (selected.length > 0) {
          return selected;
        }
      }
    }
  } catch {
    // fallback to Binance
  }

  // 2. Fallback to Binance Futures 24hr tickers (all linear pairs, works globally)
  try {
    const res = await customFetch("https://fapi.binance.com/fapi/v1/ticker/24hr", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (res.ok) {
      const list = (await res.json()) as Array<{
        symbol: string;
        lastPrice: string;
        priceChangePercent: string;
        quoteVolume: string;
      }>;
      if (Array.isArray(list) && list.length > 0) {
        const candidates: UniverseMarketOpportunity[] = list
          .filter((t) => t.symbol.endsWith("USDT") && Number(t.quoteVolume) >= 5_000_000)
          .map((t) => {
            const changePct = Number(t.priceChangePercent);
            const turnover = Number(t.quoteVolume);
            const absChange = Math.abs(changePct);
            const category: UniverseMarketOpportunity["category"] =
              absChange <= 5.0 ? "moderate" : absChange <= 15.0 ? "momentum" : "volatile";
            const anomalyType: UniverseMarketOpportunity["anomalyType"] =
              category === "volatile"
                ? "volatility_expansion"
                : turnover >= 40_000_000
                  ? "volume_breakout"
                  : "liquidity_hunt";
            return {
              symbol: t.symbol,
              lastPrice: Number(t.lastPrice),
              change24hPct: Number(changePct.toFixed(2)),
              turnover24h: turnover,
              anomalyType,
              category
            };
          });

        const selected = selectUniverseOpportunities(candidates, limit, filter);
        if (selected.length > 0) {
          return selected;
        }
      }
    }
  } catch {
    // fallback
  }

  // Fallback liquid defaults if both APIs unreachable
  const defaults: UniverseMarketOpportunity[] = [
    { symbol: "SOLUSDT", lastPrice: 182.5, change24hPct: 3.2, turnover24h: 420_000_000, anomalyType: "volume_breakout", category: "moderate" },
    { symbol: "BTCUSDT", lastPrice: 67200, change24hPct: 1.8, turnover24h: 1_200_000_000, anomalyType: "volume_breakout", category: "moderate" },
    { symbol: "LINKUSDT", lastPrice: 12.4, change24hPct: -2.1, turnover24h: 75_000_000, anomalyType: "liquidity_hunt", category: "moderate" },
    { symbol: "SUIUSDT", lastPrice: 2.15, change24hPct: 7.4, turnover24h: 85_000_000, anomalyType: "volume_breakout", category: "momentum" },
    { symbol: "NEARUSDT", lastPrice: 4.85, change24hPct: 6.9, turnover24h: 62_000_000, anomalyType: "volatility_expansion", category: "momentum" },
    { symbol: "PEPEUSDT", lastPrice: 0.0000095, change24hPct: -3.4, turnover24h: 110_000_000, anomalyType: "liquidity_hunt", category: "moderate" },
    { symbol: "DOGEUSDT", lastPrice: 0.142, change24hPct: 2.5, turnover24h: 190_000_000, anomalyType: "volume_breakout", category: "moderate" },
    { symbol: "UNIUSDT", lastPrice: 7.8, change24hPct: -1.2, turnover24h: 45_000_000, anomalyType: "liquidity_hunt", category: "moderate" }
  ];
  return selectUniverseOpportunities(defaults, limit, filter);
}
