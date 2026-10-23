import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

interface TickerPayload {
  symbol: string;
  lastPrice: number;
  high24h: string;
  low24h: string;
  price24hPcnt: string;
  volume24h: string;
  fundingRate: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.toUpperCase() ?? "BTCUSDT";

  let lastPrice = 0;
  let high24h = "—";
  let low24h = "—";
  let price24hPcnt = "+0.00%";
  let volume24h = "—";
  let fundingRate = "—";

  // 1. Try Bybit Linear Tickers
  try {
    const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      cache: "no-store"
    });
    if (res.ok) {
      const json = await res.json() as { result?: { list?: Array<Record<string, string>> } };
      const item = json.result?.list?.[0];
      if (item?.lastPrice) {
        lastPrice = Number(item.lastPrice);
        const p24 = Number(item.price24hPcnt) * 100;
        price24hPcnt = `${p24 >= 0 ? "+" : ""}${p24.toFixed(2)}%`;
        high24h = `$${Number(item.highPrice24h).toFixed(Number(item.highPrice24h) < 1 ? 6 : 2)}`;
        low24h = `$${Number(item.lowPrice24h).toFixed(Number(item.lowPrice24h) < 1 ? 6 : 2)}`;
        const turnover = Number(item.turnover24h);
        volume24h = turnover >= 1e9 ? `${(turnover / 1e9).toFixed(1)}B` : `${(turnover / 1e6).toFixed(1)}M`;
        if (item.fundingRate) {
          const fr = Number(item.fundingRate) * 100;
          fundingRate = `${fr >= 0 ? "+" : ""}${fr.toFixed(4)}%`;
        }
      }
    }
  } catch {
    // fallback
  }

  // 2. Fallback to Binance Futures
  if (!lastPrice) {
    try {
      const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol}`, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store"
      });
      if (res.ok) {
        const item = await res.json() as Record<string, string>;
        if (item?.lastPrice) {
          lastPrice = Number(item.lastPrice);
          const p24 = Number(item.priceChangePercent);
          price24hPcnt = `${p24 >= 0 ? "+" : ""}${p24.toFixed(2)}%`;
          high24h = `$${Number(item.highPrice).toFixed(Number(item.highPrice) < 1 ? 6 : 2)}`;
          low24h = `$${Number(item.lowPrice).toFixed(Number(item.lowPrice) < 1 ? 6 : 2)}`;
          const quoteVol = Number(item.quoteVolume);
          volume24h = quoteVol >= 1e9 ? `${(quoteVol / 1e9).toFixed(1)}B` : `${(quoteVol / 1e6).toFixed(1)}M`;
        }
      }
    } catch {
      // fallback
    }
  }

  const payload: TickerPayload = {
    symbol,
    lastPrice,
    high24h,
    low24h,
    price24hPcnt,
    volume24h,
    fundingRate
  };

  return NextResponse.json({ success: true, ticker: payload }, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
