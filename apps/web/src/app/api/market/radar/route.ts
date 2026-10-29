import { NextResponse, type NextRequest } from "next/server";

export interface RadarTickerItem {
  symbol: string;
  name: string;
  lastPrice: number;
  priceFormatted: string;
  change24h: number;
  changeFormatted: string;
  turnover: number;
  turnoverFormatted: string;
  high24h: string;
  low24h: string;
  regime: string;
  volumeState: string;
  status: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = (searchParams.get("category") ?? "volume").toLowerCase();
  const search = (searchParams.get("search") ?? "").toUpperCase().trim();
  const limit = Math.min(100, Math.max(10, Number(searchParams.get("limit") ?? 40)));

  let rawList: Array<{
    symbol: string;
    lastPrice: string;
    price24hPcnt: string;
    turnover24h: string;
    highPrice24h?: string | undefined;
    lowPrice24h?: string | undefined;
  }> = [];

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
            highPrice24h?: string | undefined;
            lowPrice24h?: string | undefined;
          }>;
        };
      };
      rawList = data.result?.list ?? [];
    }
  } catch {
    // If Bybit public API fails, fallback to Binance below
  }

  // Fallback to Binance Futures if Bybit returned nothing
  if (rawList.length === 0) {
    try {
      const res = await fetch("https://fapi.binance.com/fapi/v1/ticker/24hr", {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
      });
      if (res.ok) {
        const binanceList = (await res.json()) as Array<{
          symbol: string;
          lastPrice: string;
          priceChangePercent: string;
          quoteVolume: string;
          highPrice?: string;
          lowPrice?: string;
        }>;
        rawList = binanceList.map((t) => ({
          symbol: t.symbol,
          lastPrice: t.lastPrice,
          price24hPcnt: (Number(t.priceChangePercent) / 100).toString(),
          turnover24h: t.quoteVolume,
          highPrice24h: t.highPrice,
          lowPrice24h: t.lowPrice,
        }));
      }
    } catch {
      // Return empty
    }
  }

  // Filter for valid USDT perpetual pairs
  let candidates = rawList
    .filter((t) => t.symbol.endsWith("USDT") && Number(t.lastPrice) > 0 && Number(t.turnover24h ?? 0) >= 100_000)
    .map((t) => {
      const price = Number(t.lastPrice);
      const chgPct = Number(t.price24hPcnt) * 100;
      const turnover = Number(t.turnover24h ?? 0);
      const high = Number(t.highPrice24h ?? 0);
      const low = Number(t.lowPrice24h ?? 0);
      const baseCoin = t.symbol.replace("USDT", "");

      let regime = "Consolidation / Range";
      if (chgPct >= 10.0) regime = "Extreme Breakout 🔥";
      else if (chgPct >= 3.0) regime = "Bullish Momentum";
      else if (chgPct <= -10.0) regime = "Severe Dump 🔻";
      else if (chgPct <= -3.0) regime = "Bearish Pressure";
      else if (chgPct >= 1.0) regime = "Mild Uptrend";
      else if (chgPct <= -1.0) regime = "Mild Downtrend";

      let volumeState: string;
      if (turnover >= 1_000_000_000) volumeState = "Mega ($1B+)";
      else if (turnover >= 200_000_000) volumeState = "High ($200M+)";
      else if (turnover >= 40_000_000) volumeState = "Moderate ($40M+)";
      else volumeState = "Low";

      const turnoverStr =
        turnover >= 1_000_000_000
          ? `$${(turnover / 1e9).toFixed(2)}B`
          : turnover >= 1_000_000
            ? `$${(turnover / 1e6).toFixed(1)}M`
            : `$${Math.round(turnover).toLocaleString()}`;

      let status = "Scanning";
      if (Math.abs(chgPct) >= 5.0 && turnover >= 20_000_000) status = "Scalp Target";
      else if (Math.abs(chgPct) >= 2.5) status = "Volatile";
      else if (turnover >= 200_000_000) status = "Deep Liquidity";

      return {
        symbol: t.symbol,
        name: `${baseCoin} Perpetual`,
        lastPrice: price,
        priceFormatted: `$${price.toLocaleString("en-US", {
          minimumFractionDigits: price < 0.01 ? 6 : price < 1 ? 4 : 2,
          maximumFractionDigits: price < 0.01 ? 6 : price < 1 ? 4 : 2,
        })}`,
        change24h: Number(chgPct.toFixed(2)),
        changeFormatted: `${chgPct >= 0 ? "+" : ""}${chgPct.toFixed(2)}%`,
        turnover,
        turnoverFormatted: turnoverStr,
        high24h: high > 0 ? `$${high.toFixed(high < 1 ? 4 : 2)}` : "—",
        low24h: low > 0 ? `$${low.toFixed(low < 1 ? 4 : 2)}` : "—",
        regime,
        volumeState,
        status,
      };
    });

  // Apply search query if present
  if (search) {
    candidates = candidates.filter(
      (c) => c.symbol.includes(search) || c.name.toUpperCase().includes(search)
    );
  }

  // Sort by category
  if (category === "gainers") {
    candidates.sort((a, b) => b.change24h - a.change24h);
  } else if (category === "losers") {
    candidates.sort((a, b) => a.change24h - b.change24h);
  } else if (category === "volatility") {
    candidates.sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h));
  } else {
    // Default: volume (turnover)
    candidates.sort((a, b) => b.turnover - a.turnover);
  }

  const result = candidates.slice(0, limit);

  return NextResponse.json({
    totalPairs: rawList.length,
    matchedCount: candidates.length,
    category,
    tickers: result,
  });
}
