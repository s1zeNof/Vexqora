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

          // Threshold: 2% move within snapshot window
          if (absChange >= 2.0) {
            const eventType = changePct > 0 ? "price_spike" : "price_dump";
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
              aiStatus: absChange >= 3.5 ? "evaluating" : "monitoring",
              rationale: `${item.symbol} registered a rapid ${changePct > 0 ? "+" : ""}${changePct}% price impulse across ${timeDeltaSec}s on Bybit USDT perpetuals.`,
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

export interface UniverseMarketOpportunity {
  symbol: string;
  lastPrice: number;
  change24hPct: number;
  turnover24h: number;
  anomalyType: "volume_breakout" | "volatility_expansion" | "liquidity_hunt";
}

export async function fetchTopUniverseOpportunities(
  limit: number = 6,
  customFetch: typeof fetch = fetch
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
        const candidates = list
          .filter(t => t.symbol.endsWith("USDT") && Number(t.turnover24h) >= 5_000_000)
          .map(t => {
            const changePct = Number(t.price24hPcnt) * 100;
            const turnover = Number(t.turnover24h);
            const anomalyType: UniverseMarketOpportunity["anomalyType"] =
              Math.abs(changePct) >= 15 ? "volatility_expansion" : turnover >= 50_000_000 ? "volume_breakout" : "liquidity_hunt";
            return {
              symbol: t.symbol,
              lastPrice: Number(t.lastPrice),
              change24hPct: Number(changePct.toFixed(2)),
              turnover24h: turnover,
              anomalyType
            };
          })
          .sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct));

        if (candidates.length > 0) {
          return candidates.slice(0, limit);
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
        const candidates = list
          .filter(t => t.symbol.endsWith("USDT") && Number(t.quoteVolume) >= 5_000_000)
          .map(t => {
            const changePct = Number(t.priceChangePercent);
            const turnover = Number(t.quoteVolume);
            const anomalyType: UniverseMarketOpportunity["anomalyType"] =
              Math.abs(changePct) >= 15 ? "volatility_expansion" : turnover >= 50_000_000 ? "volume_breakout" : "liquidity_hunt";
            return {
              symbol: t.symbol,
              lastPrice: Number(t.lastPrice),
              change24hPct: Number(changePct.toFixed(2)),
              turnover24h: turnover,
              anomalyType
            };
          })
          .sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct));

        if (candidates.length > 0) {
          return candidates.slice(0, limit);
        }
      }
    }
  } catch {
    // fallback
  }

  // Fallback liquid defaults if both APIs unreachable
  const defaults: UniverseMarketOpportunity[] = [
    { symbol: "SUIUSDT", lastPrice: 2.15, change24hPct: 8.4, turnover24h: 85_000_000, anomalyType: "volume_breakout" },
    { symbol: "SOLUSDT", lastPrice: 182.5, change24hPct: 4.2, turnover24h: 350_000_000, anomalyType: "liquidity_hunt" },
    { symbol: "NEARUSDT", lastPrice: 4.85, change24hPct: 6.9, turnover24h: 62_000_000, anomalyType: "volatility_expansion" },
    { symbol: "BTCUSDT", lastPrice: 67200, change24hPct: 1.8, turnover24h: 1_200_000_000, anomalyType: "volume_breakout" }
  ];
  return defaults.slice(0, limit);
}
