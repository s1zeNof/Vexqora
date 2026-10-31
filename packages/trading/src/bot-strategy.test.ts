import { describe, expect, it } from "vitest";
import type { Kline } from "@crypto-bot/shared";
import {
  filterBotUniverseCandidates,
  evaluateCandidateTechnicalStructure,
  computeEMA,
  computeRSI,
  roundPriceByTick,
  type BybitLinearTicker,
} from "./bot-strategy";

function makeCandle(i: number, open: number, high: number, low: number, close: number): Kline {
  return {
    time: 1700000000000 + i * 900000,
    open,
    high,
    low,
    close,
    volume: 10000,
  };
}

describe("Bot Strategy Engine (Universe Screener & Structural TA)", () => {
  it("filters out extreme pump-and-dump coins (>18% or <-18%) and low volume", () => {
    const tickers: BybitLinearTicker[] = [
      { symbol: "PUMPUSDT", lastPrice: "0.5", price24hPcnt: "0.85", turnover24h: "5000000" }, // +85% pump - must be excluded!
      { symbol: "DEADUSDT", lastPrice: "1.0", price24hPcnt: "0.04", turnover24h: "100000" }, // turnover < 500k - excluded
      { symbol: "GOODLONGUSDT", lastPrice: "2.5", price24hPcnt: "0.065", turnover24h: "2500000" }, // +6.5% - valid long
      { symbol: "GOODSHORTUSDT", lastPrice: "10.0", price24hPcnt: "-0.05", turnover24h: "1800000" }, // -5.0% - valid short
      { symbol: "DUMPUSDT", lastPrice: "0.1", price24hPcnt: "-0.40", turnover24h: "2000000" }, // -40% crash - excluded
    ];

    const longCandidates = filterBotUniverseCandidates(tickers, { direction: "long" });
    expect(longCandidates.map((c) => c.symbol)).toEqual(["GOODLONGUSDT"]);
    expect(longCandidates.some((c) => c.symbol === "PUMPUSDT")).toBe(false);

    const shortCandidates = filterBotUniverseCandidates(tickers, { direction: "short" });
    expect(shortCandidates.map((c) => c.symbol)).toEqual(["GOODSHORTUSDT"]);
    expect(shortCandidates.some((c) => c.symbol === "DUMPUSDT")).toBe(false);
  });

  it("calculates EMA and RSI accurately", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const ema20 = computeEMA(closes, 20);
    expect(ema20).not.toBeNull();
    expect(ema20!).toBeGreaterThan(100);

    const rsi = computeRSI(closes, 14);
    expect(rsi).toBe(100); // Continuous gains
  });

  it("rejects overbought long setups (RSI > 68)", () => {
    // 35 bars of straight continuous parabolic rise (RSI will be near 100)
    const klines: Kline[] = Array.from({ length: 35 }, (_, i) => {
      const base = 50 + i * 2.0;
      return makeCandle(i, base, base + 2.5, base - 0.2, base + 2.0);
    });

    const opp = evaluateCandidateTechnicalStructure({
      symbol: "HOTUSDT",
      side: "long",
      klines,
      changePct: 6.0,
      turnover: 2000000,
      depositUsdt: 100,
      maxLeverage: 3,
      riskPerTradePct: 1,
    });

    expect(opp).toBeNull(); // Rejected due to overbought condition
  });

  it("produces valid structural setup for healthy steady uptrend", () => {
    // 45 bars of healthy oscillating ascending trend (RSI ~55-60)
    const klines: Kline[] = Array.from({ length: 45 }, (_, i) => {
      const close = 100 + i * 0.15 + Math.sin(i) * 1.5;
      const open = 100 + (i - 1) * 0.15 + Math.sin(i - 1) * 1.5;
      const high = Math.max(open, close) + 0.6;
      const low = Math.min(open, close) - 0.6;
      return makeCandle(i, open, high, low, close);
    });

    const opp = evaluateCandidateTechnicalStructure({
      symbol: "SOLUSDT",
      side: "long",
      klines,
      changePct: 4.5,
      turnover: 5000000,
      depositUsdt: 100,
      maxLeverage: 3,
      riskPerTradePct: 1,
    });

    expect(opp).not.toBeNull();
    if (opp) {
      expect(opp.sl).toBeLessThan(opp.entry);
      expect(opp.tp1).toBeGreaterThan(opp.entry);
      expect(opp.tp2).toBeGreaterThan(opp.tp1);
      expect(opp.tp3).toBeGreaterThan(opp.tp2);
      expect(opp.trailingDistancePct).toBeGreaterThanOrEqual(2.0);
      expect(opp.trailingDistancePct).toBeLessThanOrEqual(3.5);
      expect(opp.economics.feasible).toBe(true);
      expect(opp.economics.rewardRiskAfterCosts).toBeGreaterThanOrEqual(1.2);
    }
  });

  it("correctly rounds prices based on magnitude", () => {
    expect(roundPriceByTick(0.0001234567)).toBe(0.0001235);
    expect(roundPriceByTick(0.0123456)).toBe(0.01235);
    expect(roundPriceByTick(0.123456)).toBe(0.1235);
    expect(roundPriceByTick(1.23456)).toBe(1.235);
    expect(roundPriceByTick(15.2345)).toBe(15.23);
    expect(roundPriceByTick(150.2345)).toBe(150.23);
  });
});
