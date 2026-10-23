"use client";

import { useEffect, useRef, useState } from "react";

interface InitialTickerData {
  symbol: string;
  initialPrice: number;
  initialHigh24h?: string;
  initialLow24h?: string;
  initialPriceChangePct?: string;
  initialVolume24h?: string;
  initialFundingRate?: string;
}

export interface LiveTickerState {
  price: number;
  tickDirection: "up" | "down" | "neutral";
  high24h: string;
  low24h: string;
  price24hPcnt: string;
  volume24h: string;
  fundingRate: string;
  lastUpdated: number;
}

export function useLiveTicker({
  symbol,
  initialPrice,
  initialHigh24h = "—",
  initialLow24h = "—",
  initialPriceChangePct = "+0.00%",
  initialVolume24h = "—",
  initialFundingRate = "—"
}: InitialTickerData): LiveTickerState {
  const norm = symbol.toUpperCase();
  const [state, setState] = useState<LiveTickerState>({
    price: initialPrice,
    tickDirection: "neutral",
    high24h: initialHigh24h,
    low24h: initialLow24h,
    price24hPcnt: initialPriceChangePct,
    volume24h: initialVolume24h,
    fundingRate: initialFundingRate,
    lastUpdated: Date.now()
  });

  const lastPriceRef = useRef(initialPrice);
  const flashTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    lastPriceRef.current = initialPrice;
    setState((prev) => ({
      ...prev,
      price: initialPrice,
      high24h: initialHigh24h,
      low24h: initialLow24h,
      price24hPcnt: initialPriceChangePct,
      volume24h: initialVolume24h,
      fundingRate: initialFundingRate
    }));
  }, [symbol, initialPrice, initialHigh24h, initialLow24h, initialPriceChangePct, initialVolume24h, initialFundingRate]);

  useEffect(() => {
    let isMounted = true;
    let ws: WebSocket | null = null;
    let fallbackInterval: NodeJS.Timeout | null = null;

    const handleNewPrice = (newPrice: number, extra?: Partial<LiveTickerState>) => {
      if (!isMounted || !newPrice || isNaN(newPrice)) return;
      const prevPrice = lastPriceRef.current;
      const dir: "up" | "down" | "neutral" = newPrice > prevPrice ? "up" : newPrice < prevPrice ? "down" : "neutral";
      lastPriceRef.current = newPrice;

      setState((prev) => ({
        ...prev,
        price: newPrice,
        tickDirection: dir,
        lastUpdated: Date.now(),
        ...(extra?.high24h ? { high24h: extra.high24h } : {}),
        ...(extra?.low24h ? { low24h: extra.low24h } : {}),
        ...(extra?.price24hPcnt ? { price24hPcnt: extra.price24hPcnt } : {}),
        ...(extra?.volume24h ? { volume24h: extra.volume24h } : {}),
        ...(extra?.fundingRate ? { fundingRate: extra.fundingRate } : {})
      }));

      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = setTimeout(() => {
        if (isMounted) {
          setState((prev) => ({ ...prev, tickDirection: "neutral" }));
        }
      }, 700);
    };

    // 1. Bybit WebSocket Client
    try {
      ws = new WebSocket("wss://stream.bybit.com/v5/public/linear");
      ws.onopen = () => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ op: "subscribe", args: [`tickers.${norm}`] }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const raw = typeof event.data === "string" ? event.data : String(event.data);
          const msg = JSON.parse(raw) as {
            topic?: string;
            type?: string;
            data?: {
              lastPrice?: string;
              highPrice24h?: string;
              lowPrice24h?: string;
              price24hPcnt?: string;
              turnover24h?: string;
              fundingRate?: string;
            };
          };

          if (msg.topic === `tickers.${norm}` && msg.data?.lastPrice) {
            const p = Number(msg.data.lastPrice);
            const extra: Partial<LiveTickerState> = {};
            if (msg.data.highPrice24h) extra.high24h = `$${Number(msg.data.highPrice24h).toFixed(Number(msg.data.highPrice24h) < 1 ? 6 : 2)}`;
            if (msg.data.lowPrice24h) extra.low24h = `$${Number(msg.data.lowPrice24h).toFixed(Number(msg.data.lowPrice24h) < 1 ? 6 : 2)}`;
            if (msg.data.price24hPcnt) {
              const pc = Number(msg.data.price24hPcnt) * 100;
              extra.price24hPcnt = `${pc >= 0 ? "+" : ""}${pc.toFixed(2)}%`;
            }
            if (msg.data.turnover24h) {
              const to = Number(msg.data.turnover24h);
              extra.volume24h = to >= 1e9 ? `${(to / 1e9).toFixed(1)}B` : `${(to / 1e6).toFixed(1)}M`;
            }
            if (msg.data.fundingRate) {
              const fr = Number(msg.data.fundingRate) * 100;
              extra.fundingRate = `${fr >= 0 ? "+" : ""}${fr.toFixed(4)}%`;
            }
            handleNewPrice(p, extra);
          }
        } catch {
          // ignore parsing error
        }
      };

      ws.onerror = () => {
        // Fallback polling will kick in
      };
    } catch {
      // ignore
    }

    // 2. High-frequency 1.5s Ajax Poll for guarantee & non-WS networks
    const pollTicker = async () => {
      try {
        const res = await fetch(`/api/market/ticker?symbol=${norm}`, { cache: "no-store" });
        if (res.ok) {
          const json = await res.json() as {
            success?: boolean;
            ticker?: {
              lastPrice?: number;
              high24h?: string;
              low24h?: string;
              price24hPcnt?: string;
              volume24h?: string;
              fundingRate?: string;
            };
          };
          if (json.ticker?.lastPrice) {
            handleNewPrice(json.ticker.lastPrice, {
              ...(json.ticker.high24h ? { high24h: json.ticker.high24h } : {}),
              ...(json.ticker.low24h ? { low24h: json.ticker.low24h } : {}),
              ...(json.ticker.price24hPcnt ? { price24hPcnt: json.ticker.price24hPcnt } : {}),
              ...(json.ticker.volume24h ? { volume24h: json.ticker.volume24h } : {}),
              ...(json.ticker.fundingRate ? { fundingRate: json.ticker.fundingRate } : {})
            });
          }
        }
      } catch {
        // ignore network error
      }
    };

    fallbackInterval = setInterval(() => {
      void pollTicker();
    }, 1500);

    return () => {
      isMounted = false;
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      if (fallbackInterval) clearInterval(fallbackInterval);
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    };
  }, [norm]);

  return state;
}
