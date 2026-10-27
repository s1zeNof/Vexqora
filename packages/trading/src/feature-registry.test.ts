import { describe, it, expect } from "vitest";
import {
  calculateRSI,
  calculateEMA,
  calculateSMA,
  extractCanonicalFeatures,
  CANONICAL_FEATURE_NAMES
} from "./feature-registry";
import { buildMarketContextSnapshot, analyzeTimeframeStructure } from "./market-context";
import type { Kline } from "@crypto-bot/shared";

describe("Feature Registry & MTF Context (P1)", () => {
  describe("Wilder's RSI (P0.1 & P1.3)", () => {
    it("guarantees output array length strictly equals input length for all N", () => {
      expect(calculateRSI([])).toHaveLength(0);
      expect(calculateRSI([100])).toHaveLength(1);
      expect(calculateRSI(new Array<number>(14).fill(100))).toHaveLength(14);
      expect(calculateRSI(new Array<number>(15).fill(100))).toHaveLength(15);
      expect(calculateRSI(new Array<number>(30).fill(100))).toHaveLength(30);
      expect(calculateRSI(new Array<number>(300).fill(100))).toHaveLength(300);
    });

    it("verifies EMA and SMA calculations", () => {
      const data = [10, 20, 30, 40, 50];
      const ema = calculateEMA(data, 3);
      const sma = calculateSMA(data, 3);
      expect(ema).toHaveLength(5);
      expect(sma).toHaveLength(5);
      expect(sma[4]!).toBe(40); // (30+40+50)/3 = 40
    });

    it("evaluates pure uptrend to near 100", () => {
      const closes = Array.from({ length: 40 }, (_, i) => 100 + i * 2);
      const rsi = calculateRSI(closes, 14);
      expect(rsi).toHaveLength(40);
      expect(rsi[39]!).toBeGreaterThan(90);
    });

    it("evaluates pure downtrend to near 0", () => {
      const closes = Array.from({ length: 40 }, (_, i) => 200 - i * 2);
      const rsi = calculateRSI(closes, 14);
      expect(rsi).toHaveLength(40);
      expect(rsi[39]!).toBeLessThan(10);
    });
  });

  describe("Canonical Features Extraction", () => {
    it("extracts all 18 standard features without NaNs", () => {
      const klines: Kline[] = Array.from({ length: 30 }, (_, i) => ({
        time: 1729000000000 + i * 900000,
        open: 100 + i,
        high: 102 + i,
        low: 99 + i,
        close: 101 + i,
        volume: 500 + i * 10
      }));

      const features = extractCanonicalFeatures(klines);
      expect(features).toHaveLength(30);

      const lastRow = features[29]!;
      for (const name of CANONICAL_FEATURE_NAMES) {
        expect(lastRow[name]).toBeDefined();
        expect(Number.isFinite(lastRow[name])).toBe(true);
      }
    });
  });

  describe("Multi-Timeframe MarketContextSnapshot (P1.2)", () => {
    it("honestly marks missing timeframes as INSUFFICIENT_DATA", () => {
      const snapshot = buildMarketContextSnapshot({
        symbol: "SOLUSDT",
        timeframeKlines: {
          "15M": Array.from({ length: 25 }, (_, i) => ({
            time: 1729000000000 + i * 900000,
            open: 150 + i,
            high: 152 + i,
            low: 149 + i,
            close: 151 + i,
            volume: 1000
          }))
        }
      });

      expect(snapshot.symbol).toBe("SOLUSDT");
      expect(snapshot.timeframes["15M"].status).toBe("OK");
      expect(snapshot.timeframes["1D"].status).toBe("INSUFFICIENT_DATA");
      expect(snapshot.timeframes["4H"].status).toBe("INSUFFICIENT_DATA");
      expect(snapshot.dataQuality.missingTimeframes).toContain("1D");
      expect(snapshot.dataQuality.missingTimeframes).toContain("4H");
      expect(snapshot.dataQuality.hasMacroData).toBe(false);
    });

    it("requires at least 200 bars for EMA200", () => {
      const shortKlines: Kline[] = Array.from({ length: 50 }, (_, i) => ({
        time: 1729000000000 + i * 900000,
        open: 100,
        high: 105,
        low: 95,
        close: 102,
        volume: 100
      }));

      const structure = analyzeTimeframeStructure("1H", shortKlines);
      expect(structure.status).toBe("OK");
      expect(structure.ema20).not.toBeNull();
      expect(structure.ema50).not.toBeNull();
      expect(structure.hasEma200Warmup).toBe(false);
      expect(structure.ema200).toBeNull(); // Strictly null when bars < 200!
    });
  });
});
