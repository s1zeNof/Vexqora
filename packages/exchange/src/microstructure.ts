export interface ExchangeOrderBookLevel {
  price: number;
  size: number;
}

export interface ExchangeOrderBook {
  symbol: string;
  timestamp: number;
  bids: ExchangeOrderBookLevel[];
  asks: ExchangeOrderBookLevel[];
}

export interface ExchangePublicTrade {
  price: number;
  size: number;
  side: "Buy" | "Sell";
  timestamp: number;
  isBlockTrade?: boolean | undefined;
}

export interface ExchangeOpenInterestPoint {
  openInterest: number;
  timestamp: number;
}

interface BybitOrderBookResponse {
  retCode: number;
  result?: {
    s: string;
    b: Array<[string, string]>; // bids [price, size]
    a: Array<[string, string]>; // asks [price, size]
    ts: number;
  };
}

interface BybitRecentTradesResponse {
  retCode: number;
  result?: {
    list?: Array<{
      price: string;
      size: string;
      side: "Buy" | "Sell";
      time: string;
      isBlockTrade?: boolean;
    }>;
  };
}

interface BybitOpenInterestResponse {
  retCode: number;
  result?: {
    list?: Array<{
      openInterest: string;
      timestamp: string;
    }>;
  };
}

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json"
};

/**
 * Fetches L2 order book depth for a perpetual market.
 */
export async function fetchOrderBook(
  symbol: string,
  limit: 1 | 50 | 200 = 50,
  customFetch: typeof fetch = fetch
): Promise<ExchangeOrderBook | null> {
  const norm = symbol.toUpperCase();

  // 1. Bybit Linear Orderbook
  const urls = [
    `https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${norm}&limit=${limit}`,
    `https://api-demo.bybit.com/v5/market/orderbook?category=linear&symbol=${norm}&limit=${limit}`
  ];

  for (const url of urls) {
    try {
      const res = await customFetch(url, { headers: DEFAULT_HEADERS });
      if (res.ok) {
        const json = (await res.json()) as BybitOrderBookResponse;
        if (json.retCode === 0 && json.result) {
          const bids: ExchangeOrderBookLevel[] = (json.result.b ?? []).map(([p, s]) => ({
            price: Number(p),
            size: Number(s)
          })).filter(l => !Number.isNaN(l.price) && !Number.isNaN(l.size));

          const asks: ExchangeOrderBookLevel[] = (json.result.a ?? []).map(([p, s]) => ({
            price: Number(p),
            size: Number(s)
          })).filter(l => !Number.isNaN(l.price) && !Number.isNaN(l.size));

          return {
            symbol: norm,
            timestamp: json.result.ts || Date.now(),
            bids,
            asks
          };
        }
      }
    } catch {
      // try next
    }
  }

  // 2. Binance Futures fallback
  try {
    const res = await customFetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${norm}&limit=${limit}`, {
      headers: DEFAULT_HEADERS
    });
    if (res.ok) {
      const binanceJson = (await res.json()) as {
        bids?: Array<[string, string]>;
        asks?: Array<[string, string]>;
        T?: number;
      };
      const bids: ExchangeOrderBookLevel[] = (binanceJson.bids ?? []).map(([p, s]) => ({
        price: Number(p),
        size: Number(s)
      }));
      const asks: ExchangeOrderBookLevel[] = (binanceJson.asks ?? []).map(([p, s]) => ({
        price: Number(p),
        size: Number(s)
      }));

      return {
        symbol: norm,
        timestamp: binanceJson.T || Date.now(),
        bids,
        asks
      };
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Fetches recent public trades executed on the exchange.
 */
export async function fetchRecentTrades(
  symbol: string,
  limit = 200,
  customFetch: typeof fetch = fetch
): Promise<ExchangePublicTrade[]> {
  const norm = symbol.toUpperCase();

  // 1. Bybit Recent Trades
  const urls = [
    `https://api.bybit.com/v5/market/recent-trade?category=linear&symbol=${norm}&limit=${limit}`,
    `https://api-demo.bybit.com/v5/market/recent-trade?category=linear&symbol=${norm}&limit=${limit}`
  ];

  for (const url of urls) {
    try {
      const res = await customFetch(url, { headers: DEFAULT_HEADERS });
      if (res.ok) {
        const json = (await res.json()) as BybitRecentTradesResponse;
        if (json.retCode === 0 && Array.isArray(json.result?.list)) {
          return json.result.list.map((item) => ({
            price: Number(item.price),
            size: Number(item.size),
            side: item.side,
            timestamp: Number(item.time),
            isBlockTrade: item.isBlockTrade
          })).filter(t => !Number.isNaN(t.price) && !Number.isNaN(t.size));
        }
      }
    } catch {
      // try next
    }
  }

  // 2. Binance Futures fallback
  try {
    const res = await customFetch(`https://fapi.binance.com/fapi/v1/trades?symbol=${norm}&limit=${limit}`, {
      headers: DEFAULT_HEADERS
    });
    if (res.ok) {
      const binanceTrades = (await res.json()) as Array<{
        price: string;
        qty: string;
        isBuyerMaker: boolean;
        time: number;
      }>;
      if (Array.isArray(binanceTrades)) {
        return binanceTrades.map((t) => ({
          price: Number(t.price),
          size: Number(t.qty),
          // In Binance: if buyer is maker, the taker/initiator was a seller (market sell).
          side: t.isBuyerMaker ? "Sell" : "Buy",
          timestamp: t.time
        }));
      }
    }
  } catch {
    // ignore
  }

  return [];
}

/**
 * Fetches Open Interest trend points from Bybit V5 Linear.
 */
export async function fetchOpenInterest(
  symbol: string,
  limit = 24,
  customFetch: typeof fetch = fetch
): Promise<ExchangeOpenInterestPoint[]> {
  const norm = symbol.toUpperCase();
  const url = `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${norm}&intervalTime=5min&limit=${Math.min(limit, 50)}`;

  try {
    const res = await customFetch(url, { headers: DEFAULT_HEADERS });
    if (res.ok) {
      const json = (await res.json()) as BybitOpenInterestResponse;
      if (json.retCode === 0 && Array.isArray(json.result?.list)) {
        return json.result.list.map((item) => ({
          openInterest: Number(item.openInterest),
          timestamp: Number(item.timestamp)
        })).filter(p => !Number.isNaN(p.openInterest)).reverse();
      }
    }
  } catch {
    // fallback
  }

  return [];
}
