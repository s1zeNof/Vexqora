import { describe, expect, it } from "vitest";
import {
  calculateBtcDependency,
  classifyKlinesRegime,
  evaluateBtcImpactOnTrade
} from "./global-regime";
import type { Kline } from "@crypto-bot/shared";

describe("Global Market Regime Monitor (P0-10 & AT-01)", () => {
  function makeKlines(prices: number[], startTime = 1000000, intervalMs = 60000): Kline[] {
    return prices.map((close, i) => ({
      time: startTime + i * intervalMs,
      open: i > 0 ? prices[i - 1]! : close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1000
    }));
  }

  it("classifies bullish trend when price trades above EMA20 and EMA50 with strong RSI", () => {
    // Upward series
    const prices = Array.from({ length: 60 }, (_, i) => 60000 + i * 200);
    const klines = makeKlines(prices);
    const regime = classifyKlinesRegime(klines, "4H");

    expect(regime.trend).toBe("bullish_trend");
    expect(regime.ema20).toBeDefined();
    expect(regime.ema50).toBeDefined();
    expect(regime.rsi).toBeGreaterThan(60);
  });

  it("classifies bearish trend when price trades below falling EMAs", () => {
    // Downward series
    const prices = Array.from({ length: 60 }, (_, i) => 70000 - i * 250);
    const klines = makeKlines(prices);
    const regime = classifyKlinesRegime(klines, "4H");

    expect(regime.trend).toBe("bearish_trend");
    expect(regime.rsi).toBeLessThan(40);
  });

  it("returns unknown and null EMAs when candle count is insufficient (<20 bars)", () => {
    const prices = [65000, 65100, 65200];
    const klines = makeKlines(prices);
    const regime = classifyKlinesRegime(klines, "1H");

    expect(regime.trend).toBe("unknown");
    expect(regime.ema20).toBeNull();
    expect(regime.ema50).toBeNull();
  });

  it("computes accurate rolling correlation and beta between ALT and BTC", () => {
    const btcPrices = Array.from({ length: 40 }, (_, i) => 60000 + i * 100);
    // Alt strongly correlated (2x returns)
    const altPrices = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);

    const btcKlines = makeKlines(btcPrices);
    const altKlines = makeKlines(altPrices);

    const dep = calculateBtcDependency("SOLUSDT", altKlines, btcKlines);
    expect(dep.status).toBe("OK");
    expect(dep.rollingCorrelation1h).toBeGreaterThan(0.8);
    expect(dep.betaToBtc).toBeGreaterThan(0);
  });

  it("AT-01: BTC 4H flips to bearish -> triggers requiresReassessment on ALT LONG trade", () => {
    const dep = {
      symbol: "SOLUSDT",
      status: "OK" as const,
      rollingCorrelation1h: 0.88,
      rollingCorrelation4h: 0.88,
      betaToBtc: 1.25,
      relativeStrengthPct: 0.5,
      leadLag: "synchronized" as const,
      sampleBarsUsed: 50,
      asOfMs: Date.now()
    };

    const impact = evaluateBtcImpactOnTrade({
      altSide: "long",
      altSymbol: "SOLUSDT",
      btcRegime: "bearish_trend",
      btcDependency: dep
    });

    expect(impact.requiresReassessment).toBe(true);
    expect(impact.impact).toBe("HIGH_RISK");
    expect(impact.reason).toContain("BTC перейшов у спадний (BEARISH) режим");
  });

  it("identifies decoupled assets (e.g. low correlation or gold proxy) without blindly blocking", () => {
    const decoupledDep = {
      symbol: "XAUUSDT",
      status: "OK" as const,
      rollingCorrelation1h: 0.05,
      rollingCorrelation4h: 0.05,
      betaToBtc: 0.08,
      relativeStrengthPct: 4.5,
      leadLag: "decoupled" as const,
      sampleBarsUsed: 50,
      asOfMs: Date.now()
    };

    const impact = evaluateBtcImpactOnTrade({
      altSide: "long",
      altSymbol: "XAUUSDT",
      btcRegime: "bearish_trend",
      btcDependency: decoupledDep
    });

    expect(impact.requiresReassessment).toBe(false);
    expect(impact.impact).toBe("NEUTRAL");
    expect(impact.reason).toContain("decoupled");
  });
});
