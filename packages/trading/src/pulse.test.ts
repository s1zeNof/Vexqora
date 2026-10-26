import { describe, expect, it } from "vitest";
import { fetchTopUniverseOpportunities, VexqoraPulseScanner } from "./pulse";

describe("Vexqora Pulse Scanner", () => {
  it("detects rapid price spike anomalies across universe", () => {
    const scanner = new VexqoraPulseScanner();
    const t0 = 1000000;

    // Snapshot 1
    scanner.processTickers([
      { symbol: "DOODUSDT", lastPrice: "1.00", turnover24h: "2000000" }
    ], t0);

    // Snapshot 2: 15 seconds later, price +10.33%
    const anomalies = scanner.processTickers([
      { symbol: "DOODUSDT", lastPrice: "1.1033", turnover24h: "2500000" }
    ], t0 + 15000);

    expect(anomalies.length).toBe(1);
    const pulse = anomalies[0]!;
    expect(pulse.symbol).toBe("DOODUSDT");
    expect(pulse.eventType).toBe("price_spike");
    expect(pulse.changePct).toBe(10.33);
    expect(pulse.timeframeSec).toBe(15);
    expect(pulse.historicalMatch.sampleCount).toBeGreaterThan(0);
  });

  it("filters out low-turnover illiquid pairs", () => {
    const scanner = new VexqoraPulseScanner();
    const t0 = 1000000;

    scanner.processTickers([
      { symbol: "DUSTUSDT", lastPrice: "0.10", turnover24h: "100000" }
    ], t0);

    const anomalies = scanner.processTickers([
      { symbol: "DUSTUSDT", lastPrice: "0.20", turnover24h: "120000" }
    ], t0 + 15000);

    expect(anomalies.length).toBe(0);
  });

  it("detects whale accumulation on high-turnover moderate coins with realistic impulse", () => {
    const scanner = new VexqoraPulseScanner();
    const t0 = 1000000;

    // Snapshot 1: liquid coin SOLUSDT
    scanner.processTickers([
      { symbol: "SOLUSDT", lastPrice: "180.00", turnover24h: "80000000" }
    ], t0);

    // Snapshot 2: 12 seconds later, price +0.85% (whale sweep on high turnover)
    const anomalies = scanner.processTickers([
      { symbol: "SOLUSDT", lastPrice: "181.53", turnover24h: "82000000" }
    ], t0 + 12000);

    expect(anomalies.length).toBe(1);
    const pulse = anomalies[0]!;
    expect(pulse.symbol).toBe("SOLUSDT");
    expect(pulse.eventType).toBe("whale_accumulation");
    expect(pulse.changePct).toBe(0.85);
    expect(pulse.turnover24h).toBe(82000000);
  });

  it("fetches top universe opportunities with balanced moderate (-5%..+5%) distribution", async () => {
    const opps = await fetchTopUniverseOpportunities(6, undefined, "balanced");
    expect(opps.length).toBe(6);
    // At least half (>= 3) should be steady moderate pairs
    const moderateCount = opps.filter((o) => Math.abs(o.change24hPct) <= 5.0).length;
    expect(moderateCount).toBeGreaterThanOrEqual(3);
  });

  it("strictly filters for moderate coins when filter is set to moderate", async () => {
    const opps = await fetchTopUniverseOpportunities(4, undefined, "moderate");
    expect(opps.length).toBe(4);
    for (const opp of opps) {
      expect(Math.abs(opp.change24hPct)).toBeLessThanOrEqual(5.0);
    }
  });
});
