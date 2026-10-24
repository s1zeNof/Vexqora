import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import {
  detectKlineGaps,
  saveHistoricalKlines,
  loadHistoricalKlines,
  saveDailyTrades,
  loadDailyTrades,
  saveFundingRates,
  loadFundingRates,
  saveOpenInterest,
  loadOpenInterest,
  getDataLakeCoverageSummary
} from "./storage";
import type { HistoricalKlineRecord, PublicTradeRecord } from "./types";

const TEST_DATA_DIR = path.resolve(__dirname, "../.test_data");

describe("Data Lake Storage & Gap Detection", () => {
  beforeEach(() => {
    process.env.DATA_LAKE_PATH = TEST_DATA_DIR;
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
    delete process.env.DATA_LAKE_PATH;
  });

  it("detects gaps when candlestick interval jumps abnormally", () => {
    const klines: HistoricalKlineRecord[] = [
      { timestamp: 1000, open: 10, high: 12, low: 9, close: 11, volume: 100, turnover: 1000 },
      { timestamp: 2000, open: 11, high: 13, low: 10, close: 12, volume: 100, turnover: 1000 },
      // Jump from 2000 to 5000 (gap > 1.5 * 1000)
      { timestamp: 5000, open: 12, high: 14, low: 11, close: 13, volume: 100, turnover: 1000 }
    ];

    const gaps = detectKlineGaps(klines, 1000);
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.from).toBe(2000);
    expect(gaps[0]!.to).toBe(5000);
  });

  it("saves, compresses, deduplicates and queries historical klines", async () => {
    const batch1: HistoricalKlineRecord[] = [
      { timestamp: 1000, open: 100, high: 105, low: 95, close: 102, volume: 50, turnover: 5000 },
      { timestamp: 2000, open: 102, high: 106, low: 100, close: 104, volume: 60, turnover: 6000 }
    ];

    const meta = await saveHistoricalKlines("BTCUSDT", "15m", batch1);
    expect(meta.count).toBe(2);
    expect(meta.symbol).toBe("BTCUSDT");

    // Add overlapping batch with deduplication and new candle
    const batch2: HistoricalKlineRecord[] = [
      { timestamp: 2000, open: 102, high: 106, low: 100, close: 104, volume: 60, turnover: 6000 },
      { timestamp: 3000, open: 104, high: 110, low: 103, close: 108, volume: 70, turnover: 7000 }
    ];

    const meta2 = await saveHistoricalKlines("BTCUSDT", "15m", batch2);
    expect(meta2.count).toBe(3); // Deduplicated 2000

    const loaded = await loadHistoricalKlines("BTCUSDT", "15m");
    expect(loaded.length).toBe(3);
    expect(loaded[0]!.timestamp).toBe(1000);
    expect(loaded[2]!.timestamp).toBe(3000);

    // Range filtering
    const range = await loadHistoricalKlines("BTCUSDT", "15m", { fromTime: 2000, toTime: 2500 });
    expect(range.length).toBe(1);
    expect(range[0]!.timestamp).toBe(2000);
  });

  it("saves and loads daily trade archives", async () => {
    const trades: PublicTradeRecord[] = [
      { timestamp: 1700000000000, price: 65100, size: 0.5, side: "Buy", tickDirection: "PlusTick" },
      { timestamp: 1700000001000, price: 65090, size: 1.2, side: "Sell", tickDirection: "MinusTick" }
    ];

    await saveDailyTrades("ETHUSDT", "2024-01-01", trades);

    const loaded = await loadDailyTrades("ETHUSDT", "2024-01-01");
    expect(loaded.length).toBe(2);
    expect(loaded[0]!.price).toBe(65100);
    expect(loaded[1]!.side).toBe("Sell");
  });

  it("saves, merges and queries funding rates and open interest", async () => {
    await saveFundingRates("SOLUSDT", [
      { timestamp: 1000, fundingRate: 0.0001, symbol: "SOLUSDT" },
      { timestamp: 2000, fundingRate: 0.00015, symbol: "SOLUSDT" }
    ]);

    const funding = await loadFundingRates("SOLUSDT");
    expect(funding.length).toBe(2);
    expect(funding[1]!.fundingRate).toBe(0.00015);

    await saveOpenInterest("SOLUSDT", [
      { timestamp: 1000, openInterest: 500000, symbol: "SOLUSDT" }
    ]);

    const oi = await loadOpenInterest("SOLUSDT");
    expect(oi.length).toBe(1);
    expect(oi[0]!.openInterest).toBe(500000);
  });

  it("produces data lake coverage summary", async () => {
    const summary = await getDataLakeCoverageSummary();
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.some((s) => s.symbol === "BTCUSDT" && s.dataset === "klines")).toBe(true);
  });
});
