import { describe, expect, it } from "vitest";
import { verifyExecutionGates } from "./ensemble-gate";

describe("Decision Ensemble Gate (P0-06)", () => {
  const baseValidParams = {
    symbol: "SOLUSDT",
    side: "long" as const,
    entryPrice: 150.0,
    stopLoss: 145.0,
    tp1: 160.0,
    riskReward: 2.0,
    structureTrend: "bullish" as const,
    evUsd: 12.5,
    winProbabilityPct: 62.0,
    hasCriticalNews: false
  };

  it("passes when all 4 gates have positive valid evidence", () => {
    const result = verifyExecutionGates(baseValidParams);
    expect(result.passed).toBe(true);
    expect(result.verdict).toBe("PASS");
    expect(result.gates.gate1Structure.status).toBe("PASS");
    expect(result.gates.gate2MlEv.status).toBe("PASS");
    expect(result.gates.gate3Risk.status).toBe("PASS");
    expect(result.gates.gate4ExecutionGuard.status).toBe("PASS");
    expect(result.rejectionReasons).toHaveLength(0);
  });

  it("marks missing evidence as UNKNOWN and fails-closed by default for NEW_ENTRY", () => {
    const result = verifyExecutionGates({
      symbol: "SOLUSDT",
      side: "long",
      entryPrice: 150.0,
      stopLoss: 145.0,
      tp1: 160.0,
      riskReward: 2.0
      // structureTrend, evUsd, hasCriticalNews omitted
    });

    expect(result.passed).toBe(false);
    expect(result.verdict).toBe("GATE_REJECTED");
    expect(result.gates.gate1Structure.status).toBe("UNKNOWN");
    expect(result.gates.gate2MlEv.status).toBe("UNKNOWN");
    expect(result.gates.gate3Risk.status).toBe("PASS");
    expect(result.gates.gate4ExecutionGuard.status).toBe("UNKNOWN");
    expect(result.rejectionReasons.some(r => r.includes("Gate 1 (Structure)"))).toBe(true);
    expect(result.rejectionReasons.some(r => r.includes("Gate 2 (ML/EV)"))).toBe(true);
    expect(result.rejectionReasons.some(r => r.includes("Gate 4 (News)"))).toBe(true);
  });

  it("permits entry with warnings only when caller explicitly configures permissive paper policy", () => {
    const result = verifyExecutionGates({
      symbol: "SOLUSDT",
      side: "long",
      entryPrice: 150.0,
      stopLoss: 145.0,
      tp1: 160.0,
      riskReward: 2.0,
      policy: {
        allowUnknownStructureForEntry: true,
        allowUnknownMlForEntry: true,
        allowUnknownNewsForEntry: true
      }
    });

    expect(result.passed).toBe(true);
    expect(result.verdict).toBe("PASS");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.rejectionReasons).toHaveLength(0);
  });

  it("blocks new entry if negative EV or mlDecision NO_TRADE", () => {
    const negEvResult = verifyExecutionGates({
      ...baseValidParams,
      evUsd: -5.4
    });
    expect(negEvResult.passed).toBe(false);
    expect(negEvResult.gates.gate2MlEv.status).toBe("REJECTED");
    expect(negEvResult.rejectionReasons.some(r => r.includes("EV = -5.4 USD"))).toBe(true);

    const mlNoTradeResult = verifyExecutionGates({
      ...baseValidParams,
      mlDecision: "NO_TRADE"
    });
    expect(mlNoTradeResult.passed).toBe(false);
    expect(mlNoTradeResult.gates.gate2MlEv.status).toBe("REJECTED");
  });

  it("blocks new entry when entering against strong structure trend", () => {
    const counterTrendResult = verifyExecutionGates({
      ...baseValidParams,
      side: "long",
      structureTrend: "bearish"
    });
    expect(counterTrendResult.passed).toBe(false);
    expect(counterTrendResult.gates.gate1Structure.status).toBe("REJECTED");
    expect(counterTrendResult.rejectionReasons.some(r => r.includes("BEARISH"))).toBe(true);
  });

  it("blocks new entry when critical news shock is flagged", () => {
    const newsBlockedResult = verifyExecutionGates({
      ...baseValidParams,
      hasCriticalNews: true
    });
    expect(newsBlockedResult.passed).toBe(false);
    expect(newsBlockedResult.gates.gate4ExecutionGuard.status).toBe("REJECTED");
  });

  it("deterministic safety gate rejects invalid stop loss, kill-switch, or low RR", () => {
    const badSl = verifyExecutionGates({
      ...baseValidParams,
      side: "long",
      stopLoss: 155.0 // SL higher than entry
    });
    expect(badSl.passed).toBe(false);
    expect(badSl.gates.gate3Risk.status).toBe("REJECTED");

    const killSwitch = verifyExecutionGates({
      ...baseValidParams,
      killSwitchActive: true
    });
    expect(killSwitch.passed).toBe(false);
    expect(killSwitch.gates.gate3Risk.status).toBe("REJECTED");

    const lowRr = verifyExecutionGates({
      ...baseValidParams,
      riskReward: 0.8
    });
    expect(lowRr.passed).toBe(false);
    expect(lowRr.gates.gate3Risk.status).toBe("REJECTED");
  });

  it("FAIL-SAFE: emergency exits and risk reductions are NEVER blocked by missing ML/news or active kill switch", () => {
    const emergencyClose = verifyExecutionGates({
      symbol: "SOLUSDT",
      side: "long",
      entryPrice: 150.0,
      stopLoss: 145.0,
      tp1: 160.0,
      riskReward: 2.0,
      operationType: "EMERGENCY_EXIT",
      killSwitchActive: true,
      dailyLossBreached: true,
      policy: {
        allowUnknownStructureForEntry: false,
        allowUnknownMlForEntry: false,
        allowUnknownNewsForEntry: false
      }
    });

    expect(emergencyClose.passed).toBe(true);
    expect(emergencyClose.verdict).toBe("PASS");
    expect(emergencyClose.rejectionReasons).toHaveLength(0);
  });
});
