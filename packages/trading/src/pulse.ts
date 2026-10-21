import { findHistoricalPatternMatch, type HistoricalPatternMatch } from "./memory";

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
  eventType: "price_spike" | "price_dump" | "volume_spike" | "liquidity_sweep";
  changePct: number;
  timeframeSec: number;
  price: number;
  turnover24h: number;
  aiStatus: "monitoring" | "evaluating" | "signal_generated" | "no_trade";
  rationale: string;
  historicalMatch: HistoricalPatternMatch;
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
