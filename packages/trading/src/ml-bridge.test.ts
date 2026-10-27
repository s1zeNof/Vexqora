import { describe, it, expect } from "vitest";
import { calculateExpectedValue, queryMLModelPrediction } from "./ml-bridge";

describe("ML Bridge & Expected Value (EV) Engine", () => {
  describe("calculateExpectedValue", () => {
    it("calculates positive EV for institutional 1:1.8 setup with 60% win rate", () => {
      const res = calculateExpectedValue({
        winProbabilityPct: 60,
        riskUsd: 100,
        rewardUsd: 180,
        entryPrice: 65000
      });

      // Expected: (0.60 * 180) - (0.40 * 100) - fees = 108 - 40 - 1.10 = ~66.90
      expect(res.isPositiveEv).toBe(true);
      expect(res.evUsd).toBeGreaterThan(60);
      expect(res.evPerDollarRisked).toBeGreaterThan(0.6);
      expect(res.totalFeesUsd).toBeGreaterThan(0);
    });

    it("identifies negative EV trade and accounts for exchange fees", () => {
      const res = calculateExpectedValue({
        winProbabilityPct: 45,
        riskUsd: 100,
        rewardUsd: 100,
        entryPrice: 50000
      });

      // (0.45 * 100) - (0.55 * 100) - fees = 45 - 55 - fees = negative
      expect(res.isPositiveEv).toBe(false);
      expect(res.evUsd).toBeLessThan(0);
    });
  });

  describe("queryMLModelPrediction", () => {
    it("falls back gracefully to calibrated Bayesian engine when Python server offline", async () => {
      const res = await queryMLModelPrediction({
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 65000,
        stopLoss: 64000,
        tp1: 66800,
        klines: [
          { time: 1000, open: 64800, high: 65200, low: 64700, close: 65000, volume: 100 }
        ]
      });

      expect(res.symbol).toBe("BTCUSDT");
      expect(res.winProbabilityPct).toBeGreaterThan(40);
      expect(res.modelType).toBe("MODEL_UNAVAILABLE");
      expect(res.isFallback).toBe(true);
      expect(res.status).toBe("MODEL_UNAVAILABLE");
      expect(res.decision).toBe("NO_TRADE");
      expect(typeof res.expectedValueUsd).toBe("number");
    });

    it("rejects entry when overextended or mathematically unprofitable", async () => {
      // Overextended asset (e.g. pumped +45% in 24h)
      const res = await queryMLModelPrediction({
        symbol: "MEMEUSDT",
        side: "long",
        entryPrice: 1.0,
        stopLoss: 0.95,
        tp1: 1.02, // poor R:R
        klines: []
      });

      expect(res.decision).toBe("NO_TRADE");
      expect(res.rejectionReason).toBeDefined();
    });
  });
});
