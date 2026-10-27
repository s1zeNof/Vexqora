import { describe, it, expect } from "vitest";
import {
  analyzeTimeframeStructure,
  buildMarketContextSnapshot
} from "./market-context";
import { calculateEMA, calculateRSI } from "./feature-registry";
import type { Kline } from "@crypto-bot/shared";

describe("market-context MTF and Structure Analysis", () => {
  it("calculates EMA and RSI correctly", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const ema = calculateEMA(closes, 14);
    expect(ema.length).toBe(30);
    expect(ema[29]).toBeGreaterThan(100);

    const rsi = calculateRSI(closes, 14);
    expect(rsi.length).toBe(30);
    // Continuously rising closes should yield a very high RSI (> 70)
    expect(rsi[29]).toBeGreaterThan(70);
  });

  it("finds a real Bullish BOS on a mathematically valid OHLC candle sequence", () => {
    // Generate 30 bars ranging between 95 and 105
    // Ensure strict OHLC validity: high >= max(open, close) and low <= min(open, close)
    const klines: Kline[] = [];
    const baseTime = 1700000000000;

    for (let i = 0; i < 28; i++) {
      const open = 100 + (i % 3);
      const close = 101 + (i % 2);
      const high = 105; // Pivot high across bars 0..27
      const low = 95;
      klines.push({
        time: baseTime + i * 900000,
        open,
        high,
        low,
        close,
        volume: 1000
      });
    }

    // Bar 28: Stays inside range
    klines.push({
      time: baseTime + 28 * 900000,
      open: 101,
      high: 104,
      low: 100,
      close: 103,
      volume: 1200
    });

    // Bar 29: Breakout candle! Closes at 108 (> prior swingHigh 105)
    // High is 110, so high >= close (valid OHLC)
    klines.push({
      time: baseTime + 29 * 900000,
      open: 103,
      high: 110,
      low: 102,
      close: 108,
      volume: 3500
    });

    const analysis = analyzeTimeframeStructure("15M", klines);

    expect(analysis.status).toBe("OK");
    expect(analysis.barsCount).toBe(30);
    expect(analysis.lastClose).toBe(108);
    // Swing high is calculated across prior confirmed bars (excluding the breakout bar)
    expect(analysis.swingHigh).toBe(105);
    expect(analysis.swingLow).toBe(95);
    // Since lastClose (108) > swingHigh (105) and prevClose (103) <= swingHigh (105)
    expect(analysis.structureShift).toBe("BOS");
  });

  it("finds a Bearish BOS when price breaks below prior swingLow", () => {
    const klines: Kline[] = [];
    const baseTime = 1700000000000;

    // 25 bars in range [90, 110]
    for (let i = 0; i < 25; i++) {
      klines.push({
        time: baseTime + i * 900000,
        open: 100,
        high: 105,
        low: 95, // Swing low is 95
        close: 98,
        volume: 1000
      });
    }

    // Bar 25: Breakdown candle
    klines.push({
      time: baseTime + 25 * 900000,
      open: 96,
      high: 97,
      low: 88,
      close: 90, // lastClose < swingLow 95
      volume: 4000
    });

    const analysis = analyzeTimeframeStructure("1H", klines);

    expect(analysis.status).toBe("OK");
    expect(analysis.lastClose).toBe(90);
    expect(analysis.swingLow).toBe(95);
    expect(analysis.structureShift).toBe("BOS");
  });

  it("evaluates EMA200 warmup requirement accurately", () => {
    const shortKlines: Kline[] = Array.from({ length: 50 }, (_, i) => ({
      time: 1700000000000 + i * 60000,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 100
    }));

    const shortAnalysis = analyzeTimeframeStructure("15M", shortKlines);
    expect(shortAnalysis.hasEma200Warmup).toBe(false);
    expect(shortAnalysis.ema200).toBeNull();

    const longKlines: Kline[] = Array.from({ length: 205 }, (_, i) => ({
      time: 1700000000000 + i * 60000,
      open: 100,
      high: 101,
      low: 99,
      close: 100 + (i % 5),
      volume: 100
    }));

    const longAnalysis = analyzeTimeframeStructure("15M", longKlines);
    expect(longAnalysis.hasEma200Warmup).toBe(true);
    expect(longAnalysis.ema200).not.toBeNull();
  });

  it("builds a full market context snapshot and flags missing timeframes", () => {
    const klines15m: Kline[] = Array.from({ length: 25 }, (_, i) => ({
      time: 1700000000000 + i * 900000,
      open: 100,
      high: 102,
      low: 98,
      close: 101,
      volume: 500
    }));

    const snapshot = buildMarketContextSnapshot({
      symbol: "BTCUSDT",
      timeframeKlines: {
        "15M": klines15m
      }
    });

    expect(snapshot.symbol).toBe("BTCUSDT");
    expect(snapshot.timeframes["15M"].status).toBe("OK");
    expect(snapshot.timeframes["4H"].status).toBe("INSUFFICIENT_DATA");
    expect(snapshot.timeframes["1D"].status).toBe("INSUFFICIENT_DATA");
    expect(snapshot.dataQuality.missingTimeframes).toContain("4H");
    expect(snapshot.dataQuality.missingTimeframes).toContain("1D");
    expect(snapshot.dataQuality.allCandlesClosed).toBe(false);
  });
});
