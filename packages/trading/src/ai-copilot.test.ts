import { describe, expect, it } from "vitest";
import { generateOpportunityFromTicker, enhanceSignal } from "./ai-copilot";

describe("AI Copilot", () => {
  it("generates deterministic validated signal opportunity from live ticker", () => {
    const opp = generateOpportunityFromTicker("BTCUSDT", 65000);
    expect(opp.symbol).toBe("BTCUSDT");
    expect(opp.side).toBe("long");
    expect(opp.currentPrice).toBe(65000);
    expect(opp.stopLoss).toBeLessThan(65000);
    expect(opp.takeProfits[0]!.price).toBeGreaterThan(65000);
    expect(opp.qualityScore).toBeGreaterThanOrEqual(8.0);
    expect(opp.parsedSignal.symbol).toBe("BTCUSDT");
    expect(opp.parsedSignal.takeProfits.length).toBe(3);
  });

  it("enhances overly tight stop-loss and single TP signal", () => {
    const raw = `ETHUSDT LONG
entry 3000
tp 3200 100%
sl 2990`;

    const res = enhanceSignal(raw, 3000);
    expect(res.parsedSignal.stopLoss).toBeLessThan(2990); // Extended buffer
    expect(res.parsedSignal.takeProfits.length).toBe(2); // Split single TP
    expect(res.improvements.length).toBeGreaterThan(0);
  });
});
