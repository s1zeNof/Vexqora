import { describe, it, expect } from "vitest";
import {
  calculateOrderBookImbalance,
  analyzeRecentTrades,
  detectLiquiditySweep,
  analyzeDerivativesPressure,
  classifyMarketRegime,
  evaluateMarketMicrostructure
} from "./microstructure";
import type { Kline } from "@crypto-bot/shared";

describe("Market Microstructure Analysis", () => {
  describe("Order Book Imbalance (OBI)", () => {
    it("handles empty order book gracefully", () => {
      const res = calculateOrderBookImbalance([], []);
      expect(res.linearImbalance).toBe(0);
      expect(res.weightedImbalance).toBe(0);
      expect(res.spreadPct).toBe(0);
    });

    it("calculates positive OBI for bid-heavy order book", () => {
      const bids = [
        { price: 65000, size: 5.0 }, // $325,000
        { price: 64990, size: 10.0 } // $649,900
      ];
      const asks = [
        { price: 65005, size: 1.0 }, // $65,005
        { price: 65010, size: 1.5 }  // $97,515
      ];

      const res = calculateOrderBookImbalance(bids, asks);
      expect(res.linearImbalance).toBeGreaterThan(0.5);
      expect(res.weightedImbalance).toBeGreaterThan(0.5);
      expect(res.bestBid).toBe(65000);
      expect(res.bestAsk).toBe(65005);
      expect(res.midPrice).toBe(65002.5);
      expect(res.spreadPct).toBeGreaterThan(0);
      expect(res.microPrice).toBeGreaterThan(65000);
    });

    it("calculates negative OBI for ask-heavy order book", () => {
      const bids = [{ price: 100, size: 1.0 }];
      const asks = [{ price: 101, size: 10.0 }];

      const res = calculateOrderBookImbalance(bids, asks);
      expect(res.linearImbalance).toBeLessThan(-0.5);
      expect(res.weightedImbalance).toBeLessThan(-0.5);
    });
  });

  describe("Tape & Whale Detection", () => {
    it("computes CVD and extracts whale block trades", () => {
      const now = Date.now();
      const trades = [
        { price: 65000, size: 0.1, side: "Buy" as const, timestamp: now - 3000 },
        { price: 65010, size: 1.5, side: "Buy" as const, timestamp: now - 2000 }, // $97,515 -> Whale!
        { price: 65005, size: 0.2, side: "Sell" as const, timestamp: now - 1000 }
      ];

      const res = analyzeRecentTrades(trades, 50_000);
      expect(res.cvdUsd).toBeGreaterThan(0);
      expect(res.whaleTradesCount).toBe(1);
      expect(res.whaleBuyVolumeUsd).toBeGreaterThan(90_000);
      expect(res.buyerAggressionPct).toBeGreaterThan(80);
      expect(res.whaleTrades[0]?.side).toBe("Buy");
    });
  });

  describe("Liquidity Sweep Detection (Turtle Soup)", () => {
    const makeKlines = (highs: number[], lows: number[]): Kline[] => {
      return highs.map((h, i) => ({
        time: 1000 + i * 900000,
        open: (h + lows[i]!) / 2,
        high: h,
        low: lows[i]!,
        close: (h + lows[i]!) / 2,
        volume: 100
      }));
    };

    it("detects Bullish Liquidity Sweep (Turtle Soup Long)", () => {
      // 15 previous candles with swing low at 60,000
      const prevHighs = Array<number>(15).fill(62000);
      const prevLows = Array<number>(15).fill(60000);
      const klines = makeKlines(prevHighs, prevLows);

      // Current candle pierces 60,000 down to 59,500, but currently recovered to 60,200
      klines.push({
        time: 20000,
        open: 60500,
        high: 60600,
        low: 59500,
        close: 60200,
        volume: 500
      });

      const res = detectLiquiditySweep(klines, 60200);
      expect(res.isSweep).toBe(true);
      expect(res.type).toBe("sweep_low_bullish");
      expect(res.sweptLevel).toBe(60000);
      expect(res.rejectionCandleClose).toBe(60200);
    });

    it("detects Bearish Liquidity Sweep (Turtle Soup Short)", () => {
      const prevHighs = Array<number>(15).fill(70000);
      const prevLows = Array<number>(15).fill(68000);
      const klines = makeKlines(prevHighs, prevLows);

      // Current candle spiked to 70,500 but rejected down to 69,800
      klines.push({
        time: 20000,
        open: 69500,
        high: 70500,
        low: 69400,
        close: 69800,
        volume: 500
      });

      const res = detectLiquiditySweep(klines, 69800);
      expect(res.isSweep).toBe(true);
      expect(res.type).toBe("sweep_high_bearish");
      expect(res.sweptLevel).toBe(70000);
    });
  });

  describe("Derivatives Squeeze Analysis", () => {
    it("flags short squeeze when price pumps, OI drops, funding is negative", () => {
      const oiPoints = [
        { openInterest: 100_000, timestamp: 1000 },
        { openInterest: 94_000, timestamp: 2000 } // -6% drop
      ];

      const res = analyzeDerivativesPressure(oiPoints, -0.0003, 3.5); // price +3.5%, funding -0.03%
      expect(res.squeezeRisk).toBe("short_squeeze_high");
      expect(res.description).toContain("Short Squeeze Active");
    });

    it("flags long flush when price dumps, OI drops, funding is positive", () => {
      const oiPoints = [
        { openInterest: 100_000, timestamp: 1000 },
        { openInterest: 95_000, timestamp: 2000 } // -5% drop
      ];

      const res = analyzeDerivativesPressure(oiPoints, 0.0002, -3.2); // price -3.2%, funding +0.02%
      expect(res.squeezeRisk).toBe("long_flush_high");
      expect(res.description).toContain("Long Flush Active");
    });
  });

  describe("Market Regime & Orchestration", () => {
    it("identifies Absorption Long regime", () => {
      const ob = {
        linearImbalance: 0.3,
        weightedImbalance: 0.25,
        spreadPct: 0.01,
        bestBid: 65000,
        bestAsk: 65005,
        midPrice: 65002.5,
        microPrice: 65003,
        totalBidVolumeUsd: 500000,
        totalAskVolumeUsd: 300000
      };
      const tape = {
        cvdUsd: -80_000, // aggressive market selling
        buyVolumeUsd: 100000,
        sellVolumeUsd: 180000,
        whaleTradesCount: 0,
        whaleBuyVolumeUsd: 0,
        whaleSellVolumeUsd: 0,
        buyerAggressionPct: 35,
        whaleTrades: []
      };
      const derivatives = {
        oiChangePct: 0,
        fundingRatePct: 0.01,
        squeezeRisk: "none" as const,
        description: ""
      };

      const regime = classifyMarketRegime(ob, tape, derivatives, 0.1); // price held slightly green despite heavy selling!
      expect(regime).toBe("absorption_long");
    });

    it("evaluates end-to-end microstructure with bullish bias", () => {
      const klines: Kline[] = Array(15).fill(null).map((_, i) => ({
        time: 1000 + i * 900000,
        open: 65000,
        high: 65500,
        low: 64500,
        close: 65000,
        volume: 100
      }));

      const res = evaluateMarketMicrostructure({
        symbol: "BTCUSDT",
        orderBook: {
          symbol: "BTCUSDT",
          timestamp: Date.now(),
          bids: [{ price: 65000, size: 10 }],
          asks: [{ price: 65005, size: 2 }]
        },
        trades: [
          { price: 65005, size: 2, side: "Buy", timestamp: Date.now() - 1000 } // $130k whale buy
        ],
        klines,
        priceChangePct: 1.2
      });

      expect(res.dominantBias).toBe("bullish");
      expect(res.orderBook.weightedImbalance).toBeGreaterThan(0.3);
      expect(res.evidence.length).toBeGreaterThan(0);
      expect(res.summary).toContain("BTCUSDT microstructure");
    });
  });
});
