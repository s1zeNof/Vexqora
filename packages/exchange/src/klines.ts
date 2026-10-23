import type { Kline } from "@crypto-bot/shared";

interface BybitKlineEnvelope {
  retCode: number;
  retMsg: string;
  result: {
    symbol: string;
    category: string;
    list: string[][];
  };
}

export async function fetchRecentKlines(
  symbol: string,
  interval = "15",
  limit = 15,
  customFetch: typeof fetch = fetch
): Promise<Kline[]> {
  const norm = symbol.toUpperCase();

  // 1. Try Bybit Linear Public API
  try {
    const urls = [
      `https://api.bybit.com/v5/market/kline?category=linear&symbol=${norm}&interval=${interval}&limit=${limit}`,
      `https://api-demo.bybit.com/v5/market/kline?category=linear&symbol=${norm}&interval=${interval}&limit=${limit}`
    ];

    for (const url of urls) {
      try {
        const res = await customFetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json"
          }
        });
        if (res.ok) {
          const json = await res.json() as BybitKlineEnvelope;
          if (json.retCode === 0 && Array.isArray(json.result?.list) && json.result.list.length > 0) {
            // Bybit returns newest first, so reverse to ascending chronological order
            return json.result.list.map((row) => ({
              time: Number(row[0]),
              open: Number(row[1]),
              high: Number(row[2]),
              low: Number(row[3]),
              close: Number(row[4]),
              volume: Number(row[5])
            })).reverse();
          }
        }
      } catch {
        // try next
      }
    }
  } catch {
    // fallback
  }

  // 2. Fallback to Binance Futures
  try {
    const binanceInterval = interval === "60" ? "1h" : (interval === "240" ? "4h" : (interval === "D" ? "1d" : `${interval}m`));
    const res = await customFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${norm}&interval=${binanceInterval}&limit=${limit}`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (res.ok) {
      const data = await res.json() as unknown[][];
      if (Array.isArray(data) && data.length > 0) {
        return data.map((row) => ({
          time: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5])
        }));
      }
    }
  } catch {
    // fallback
  }

  // 3. Fallback to Binance Spot
  try {
    const binanceInterval = interval === "60" ? "1h" : (interval === "240" ? "4h" : (interval === "D" ? "1d" : `${interval}m`));
    const res = await customFetch(`https://api.binance.com/api/v3/klines?symbol=${norm}&interval=${binanceInterval}&limit=${limit}`, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (res.ok) {
      const data = await res.json() as unknown[][];
      if (Array.isArray(data) && data.length > 0) {
        return data.map((row) => ({
          time: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5])
        }));
      }
    }
  } catch {
    // fallback
  }

  return [];
}
