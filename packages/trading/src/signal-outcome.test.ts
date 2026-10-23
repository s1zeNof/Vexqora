import { describe, expect, it } from "vitest";
import { evaluateSignalOutcome, type SignalOutcomeSnapshot } from "./signal-outcome";

const base: SignalOutcomeSnapshot = {
  side: "long", entryPrice: 100, stopLoss: 95, tp1: 109, tp2: 113, tp3: 118,
  status: "monitoring", maxFavorablePct: 0, maxAdversePct: 0,
  expiresAt: "2030-01-03T00:00:00.000Z"
};

describe("signal outcome evaluator", () => {
  it("tracks successful targets without requiring a user trade", () => {
    const tp1 = evaluateSignalOutcome(base, 110, new Date("2030-01-01"));
    expect(tp1.status).toBe("tp1_hit");
    expect(tp1.resolved).toBe(false);

    const won = evaluateSignalOutcome({ ...base, status: "tp1_hit", maxFavorablePct: tp1.maxFavorablePct }, 119, new Date("2030-01-01"));
    expect(won.status).toBe("won");
    expect(won.outcome).toBe("win");
  });

  it("classifies a stop before TP1 as a learning failure", () => {
    const result = evaluateSignalOutcome(base, 94, new Date("2030-01-01"));
    expect(result.status).toBe("failed");
    expect(result.outcome).toBe("loss");
    expect(result.failureReason).toBe("stop_loss_before_tp1");
  });

  it("records an expired setup that never reached TP1", () => {
    const result = evaluateSignalOutcome(base, 102, new Date("2030-01-04"));
    expect(result.status).toBe("expired");
    expect(result.outcome).toBe("no_trigger");
    expect(result.failureReason).toBe("expired_without_tp1");
  });
});
