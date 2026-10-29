import { describe, expect, it } from "vitest";
import { calculateScalpingEconomics } from "./scalping-economics";

const base = {
  depositUsdt: 10,
  entryPrice: 100,
  stopLossPrice: 99,
  takeProfitPrice: 102,
  leverage: 5,
  riskPerTradePct: 1,
  minimumNotionalUsdt: 5,
  takerFeeBps: 5.5,
  spreadBps: 2,
  slippageBps: 3
};

describe("calculateScalpingEconomics", () => {
  it("sizes from risk and reports net economics after costs", () => {
    const result = calculateScalpingEconomics(base);
    expect(result.positionNotionalUsdt).toBeCloseTo(10);
    expect(result.marginUsedUsdt).toBeCloseTo(2);
    expect(result.estimatedNetProfitUsdt).toBeGreaterThan(0);
    expect(result.feasible).toBe(true);
  });

  it("rejects deposits that cannot meet minimum notional", () => {
    const result = calculateScalpingEconomics({ ...base, depositUsdt: 1, leverage: 1, minimumNotionalUsdt: 5 });
    expect(result.feasible).toBe(false);
    expect(result.reason).toContain("minimum notional");
  });

  it("rejects setups whose short reward is consumed by costs", () => {
    const result = calculateScalpingEconomics({ ...base, takeProfitPrice: 100.05, takerFeeBps: 10, slippageBps: 10 });
    expect(result.feasible).toBe(false);
    expect(result.reason).toContain("consume");
  });
});
