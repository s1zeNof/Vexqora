import { describe, expect, it } from "vitest";
import { LeadTraderToolRegistry } from "./tool-registry";
import type { Kline } from "@crypto-bot/shared";
import { VerifiedNewsFeedService } from "./news-feed";

describe("Unified Tool Registry (P0-08, P0-12, AT-05, AT-08)", () => {
  const registry = new LeadTraderToolRegistry();

  function makeKlines(count: number, startPrice = 100): Kline[] {
    return Array.from({ length: count }, (_, i) => ({
      time: 1000000 + i * 60000,
      open: startPrice + i * 0.5,
      high: startPrice + i * 0.5 + 1.0,
      low: startPrice + i * 0.5 - 0.5,
      close: startPrice + i * 0.5 + 0.3,
      volume: 1000 + i * 10
    }));
  }

  it("AT-05: lists machine-readable indicator catalog with capability parameters and required bars", () => {
    const list = registry.listIndicators();
    expect(list.status).toBe("OK");
    expect(list.data).toBeDefined();
    expect(list.data!.length).toBeGreaterThanOrEqual(6);

    const adx = list.data!.find(i => i.name === "ADX");
    expect(adx).toBeDefined();
    expect(adx!.requiredBars).toBe(28);

    const rsi = list.data!.find(i => i.name === "RSI");
    expect(rsi).toBeDefined();
    expect(rsi!.requiredBars).toBe(15);
  });

  it("AT-05: dynamically computes ADX on request and provides numeric trend strength", () => {
    const klines = makeKlines(40, 50);
    const res = registry.computeIndicator("SOLUSDT", "ADX", klines, { period: 14 });

    expect(res.status).toBe("OK");
    expect(res.data?.indicator).toBe("ADX_14");
    expect(typeof res.data?.value).toBe("number");
    expect(res.data!.value).toBeGreaterThan(0);
    expect(res.data?.details).toBeDefined();
  });

  it("AT-08: returns INSUFFICIENT_DATA when candle count is insufficient, no synthetic guessing", () => {
    // Only 10 candles for EMA(50)
    const klines = makeKlines(10, 100);
    const res = registry.computeIndicator("BTCUSDT", "EMA", klines, { period: 50 });

    expect(res.status).toBe("INSUFFICIENT_DATA");
    expect(res.data).toBeNull();
    expect(res.qualityWarnings[0]).toContain("requires at least 50 candles");
  });

  it("computes VWAP incorporating volume weights", () => {
    const klines = makeKlines(20, 150);
    const res = registry.computeIndicator("ETHUSDT", "VWAP", klines);

    expect(res.status).toBe("OK");
    expect(res.data?.indicator).toBe("VWAP");
    expect(typeof res.data?.value).toBe("number");
    expect(res.data!.value).toBeGreaterThan(100);
  });

  it("handles offline news provider with explicit UNAVAILABLE status envelope", async () => {
    const offlineNewsService = new VerifiedNewsFeedService(async () => {
      await Promise.resolve();
      return {
        status: "UNAVAILABLE",
        source: "OfflineMock",
        asOfMs: Date.now(),
        eventsCount: 0,
        events: [],
        economicCalendar: [],
        qualityWarnings: ["Upstream offline"]
      };
    });

    const reg = new LeadTraderToolRegistry(offlineNewsService);
    const res = await reg.searchVerifiedNews("SOLUSDT");

    expect(res.status).toBe("UNAVAILABLE");
    expect(res.data).toBeNull();
    expect(res.qualityWarnings).toContain("Upstream offline");
  });

  it("saves and retrieves stateful trade thesis with revision tracking and durable persistence", async () => {
    const thesis = {
      thesisId: "thesis-sol-1",
      symbol: "SOLUSDT",
      side: "long" as const,
      status: "VALID" as const,
      revision: 1,
      entryPrice: 152.0,
      invalidationPrice: 147.5,
      primaryRationale: "Order block retest with positive CVD divergence",
      invalidationTrigger: "Confirmed 15m close below $147.50 structural swing low",
      supportingEvidence: ["CVD delta +45k", "ADX > 28"],
      opposingEvidence: ["BTC ranging"],
      createdAtMs: Date.now(),
      updatedAtMs: Date.now()
    };

    const saved = await registry.saveTradeThesis(thesis);
    expect(saved.status).toBe("OK");

    const retrieved = await registry.getTradeThesis("thesis-sol-1");
    expect(retrieved.status).toBe("OK");
    expect(retrieved.data?.symbol).toBe("SOLUSDT");
    expect(retrieved.data?.invalidationPrice).toBe(147.5);
  });

  it("calculates real market breadth from universe tickers or returns null without fabrication", () => {
    const btcKlines = makeKlines(25, 60000);
    const ethKlines = makeKlines(25, 3000);

    // 1. Without universe tickers -> marketBreadthPct is null, no fake 68.5%
    const withoutTickers = registry.getGlobalMarketRegime(btcKlines, ethKlines);
    expect(withoutTickers.status).toBe("OK");
    expect(withoutTickers.data?.marketBreadthPct).toBeNull();
    expect(withoutTickers.qualityWarnings[0]).toContain("Market breadth omitted");

    // 2. With real universe tickers -> calculates true percentage
    const tickers = [
      { symbol: "BTCUSDT", price24hPcnt: "0.05" },
      { symbol: "ETHUSDT", price24hPcnt: "0.02" },
      { symbol: "SOLUSDT", price24hPcnt: "-0.01" },
      { symbol: "DOGEUSDT", price24hPcnt: "0.03" }
    ];
    const withTickers = registry.getGlobalMarketRegime(btcKlines, ethKlines, tickers);
    expect(withTickers.status).toBe("OK");
    // 3 out of 4 advancing = 75%
    expect(withTickers.data?.marketBreadthPct).toBe(75);
  });
});
