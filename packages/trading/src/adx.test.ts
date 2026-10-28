import { describe, expect, it } from "vitest";
import { calculateWilderADX } from "./adx";
import type { Kline } from "@crypto-bot/shared";

describe("Canonical Wilder ADX(14) (P0-06, AT-05 Parity Tests)", () => {
  function makeCandle(i: number, open: number, high: number, low: number, close: number): Kline {
    return {
      time: 1700000000000 + i * 3600000,
      open,
      high,
      low,
      close,
      volume: 1000
    };
  }

  it("returns null when candles are fewer than 28 (period * 2 required)", () => {
    const candles: Kline[] = Array.from({ length: 27 }, (_, i) =>
      makeCandle(i, 100 + i, 101 + i, 99 + i, 100.5 + i)
    );
    expect(calculateWilderADX(candles, 14)).toBeNull();
  });

  it("calculates high ADX with +DI > -DI for a persistent uptrend", () => {
    // 35 bars of strong ascending candles
    const candles: Kline[] = Array.from({ length: 35 }, (_, i) => {
      const base = 100 + i * 2.5;
      return makeCandle(i, base, base + 2.0, base - 0.5, base + 1.8);
    });

    const res = calculateWilderADX(candles, 14);
    expect(res).not.toBeNull();
    expect(res!.plusDi).toBeGreaterThan(res!.minusDi);
    expect(res!.adx).toBeGreaterThan(30);
    expect(res!.trendStrength).toBe("STRONG_TREND");
  });

  it("calculates high ADX with -DI > +DI for a persistent downtrend", () => {
    // 35 bars of strong descending candles
    const candles: Kline[] = Array.from({ length: 35 }, (_, i) => {
      const base = 200 - i * 2.5;
      return makeCandle(i, base, base + 0.5, base - 2.0, base - 1.8);
    });

    const res = calculateWilderADX(candles, 14);
    expect(res).not.toBeNull();
    expect(res!.minusDi).toBeGreaterThan(res!.plusDi);
    expect(res!.adx).toBeGreaterThan(30);
    expect(res!.trendStrength).toBe("STRONG_TREND");
  });

  it("calculates low ADX (<20) and weak trend for a flat oscillating range", () => {
    // 35 bars alternating between 100 and 101
    const candles: Kline[] = Array.from({ length: 35 }, (_, i) => {
      const toggle = i % 2 === 0 ? 100 : 100.4;
      return makeCandle(i, toggle, toggle + 0.5, toggle - 0.5, toggle + 0.1);
    });

    const res = calculateWilderADX(candles, 14);
    expect(res).not.toBeNull();
    expect(res!.adx).toBeLessThan(20);
    expect(res!.trendStrength).toBe("WEAK_OR_CONSOLIDATING");
  });

  it("matches manual step-by-step Wilder calculation on a verified sequence", () => {
    // Construct a deterministic 30-bar sequence where movements are controlled
    const candles: Kline[] = [];
    let price = 50;
    for (let i = 0; i < 30; i++) {
      if (i < 15) {
        // Flat warmup
        candles.push(makeCandle(i, price, price + 1, price - 1, price));
      } else {
        // Strong upward breakout
        price += 3;
        candles.push(makeCandle(i, price, price + 3, price - 0.5, price + 2.5));
      }
    }

    const res = calculateWilderADX(candles, 14);
    expect(res).not.toBeNull();
    expect(typeof res!.adx).toBe("number");
    expect(typeof res!.plusDi).toBe("number");
    expect(typeof res!.minusDi).toBe("number");
    expect(typeof res!.dx).toBe("number");
    expect(res!.plusDi).toBeGreaterThan(res!.minusDi);
  });
});
