import { NextResponse } from "next/server";

interface RadarTickerItem {
  symbol: string;
  name: string;
  lastPrice: number;
  priceFormatted: string;
  change24h: number;
  changeFormatted: string;
  turnoverFormatted: string;
  regime: string;
  volumeState: string;
  status: string;
}

const MONITORED_SYMBOLS: Record<string, string> = {
  BTCUSDT: "Bitcoin Perpetual",
  ETHUSDT: "Ethereum Perpetual",
  SOLUSDT: "Solana Perpetual",
  SUIUSDT: "Sui Perpetual",
  DOGEUSDT: "Dogecoin Perpetual",
  XRPUSDT: "Ripple Perpetual",
  AVAXUSDT: "Avalanche Perpetual",
  NEARUSDT: "Near Perpetual",
};

export async function GET() {
  const radarList: RadarTickerItem[] = [];

  try {
    const res = await fetch("https://api.bybit.com/v5/market/tickers?category=linear", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (res.ok) {
      const data = (await res.json()) as {
        result?: {
          list?: Array<{
            symbol: string;
            lastPrice: string;
            price24hPcnt: string;
            turnover24h: string;
            highPrice24h?: string;
            lowPrice24h?: string;
          }>;
        };
      };

      const list = data.result?.list ?? [];
      const tickerMap = new Map(list.map((t) => [t.symbol, t]));

      for (const [sym, name] of Object.entries(MONITORED_SYMBOLS)) {
        const item = tickerMap.get(sym);
        if (item && item.lastPrice) {
          const price = Number(item.lastPrice);
          const chgPct = Number(item.price24hPcnt) * 100;
          const turnover = Number(item.turnover24h ?? 0);

          let regime = "Consolidation / Range";
          if (chgPct >= 3.0) regime = "Bullish Momentum";
          else if (chgPct <= -3.0) regime = "Bearish Pressure";
          else if (chgPct >= 1.0) regime = "Mild Uptrend";
          else if (chgPct <= -1.0) regime = "Mild Downtrend";

          let volumeState = "Moderate";
          if (turnover >= 1_000_000_000) volumeState = "Ultra High ($1B+)";
          else if (turnover >= 200_000_000) volumeState = "High Liquidity";
          else if (turnover >= 50_000_000) volumeState = "Moderate Liquidity";
          else volumeState = "Low / Standard";

          const turnoverStr =
            turnover >= 1_000_000_000
              ? `$${(turnover / 1e9).toFixed(2)}B`
              : turnover >= 1_000_000
                ? `$${(turnover / 1e6).toFixed(1)}M`
                : `$${Math.round(turnover).toLocaleString()}`;

          radarList.push({
            symbol: sym,
            name,
            lastPrice: price,
            priceFormatted: `$${price.toLocaleString("en-US", {
              minimumFractionDigits: price < 1 ? 4 : 2,
              maximumFractionDigits: price < 1 ? 4 : 2,
            })}`,
            change24h: Number(chgPct.toFixed(2)),
            changeFormatted: `${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%`,
            turnoverFormatted: turnoverStr,
            regime,
            volumeState,
            status: Math.abs(chgPct) >= 2.0 ? "Scalp Candidate" : "Monitoring",
          });
        }
      }
    }
  } catch {
    // Fallback if network issue occurs
  }

  // Fallback to Binance if Bybit was empty
  if (radarList.length === 0) {
    try {
      const res = await fetch("https://fapi.binance.com/fapi/v1/ticker/24hr", {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
      });
      if (res.ok) {
        const list = (await res.json()) as Array<{
          symbol: string;
          lastPrice: string;
          priceChangePercent: string;
          quoteVolume: string;
        }>;
        const tickerMap = new Map(list.map((t) => [t.symbol, t]));

        for (const [sym, name] of Object.entries(MONITORED_SYMBOLS)) {
          const item = tickerMap.get(sym);
          if (item && item.lastPrice) {
            const price = Number(item.lastPrice);
            const chgPct = Number(item.priceChangePercent);
            const turnover = Number(item.quoteVolume ?? 0);

            radarList.push({
              symbol: sym,
              name,
              lastPrice: price,
              priceFormatted: `$${price.toLocaleString("en-US", {
                minimumFractionDigits: price < 1 ? 4 : 2,
                maximumFractionDigits: price < 1 ? 4 : 2,
              })}`,
              change24h: Number(chgPct.toFixed(2)),
              changeFormatted: `${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%`,
              turnoverFormatted: turnover >= 1e9 ? `$${(turnover / 1e9).toFixed(2)}B` : `$${(turnover / 1e6).toFixed(1)}M`,
              regime: chgPct >= 2 ? "Bullish Momentum" : chgPct <= -2 ? "Bearish Pressure" : "Consolidation",
              volumeState: turnover >= 1e8 ? "High Liquidity" : "Moderate",
              status: "Monitoring",
            });
          }
        }
      }
    } catch {
      // Fallback
    }
  }

  return NextResponse.json({ tickers: radarList });
}
