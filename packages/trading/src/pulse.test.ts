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

  it("fetches top universe opportunities from ticker feed", async () => {
    const opps = await fetchTopUniverseOpportunities(3);
    expect(opps.length).toBeGreaterThan(0);
    expect(opps[0]?.symbol).toBeDefined();
    expect(opps[0]?.lastPrice).toBeGreaterThan(0);
    expect(opps[0]?.turnover24h).toBeGreaterThan(0);
  });
});
