import { describe, expect, it } from "vitest";
import { extractSignalExecutionEvidence, toExecutionGateEvidence } from "./execution-evidence";
import type { SignalExecutionEvidence } from "./ai-copilot";

function evidence(expiresAtMs: number): SignalExecutionEvidence {
  return {
    version: 1,
    generatedAtMs: 1_000,
    expiresAtMs,
    structureTrend: "bullish",
    structureEvidence: { status: "PASS", reason: "aligned", source: "candles", dataAsOfMs: 900 },
    mlDecision: "TRADE",
    mlEvidence: { status: "PASS", reason: "positive EV", source: "CatBoost", dataAsOfMs: 950 },
    winProbabilityPct: 62,
    evUsd: 14,
    hasCriticalNews: false,
    newsStatus: "OK",
    newsEvidence: { status: "PASS", reason: "verified", source: "official", dataAsOfMs: 975 }
  };
}

describe("canonical signal execution evidence", () => {
  it("extracts evidence from persisted opportunity envelopes", () => {
    const value = evidence(10_000);
    expect(extractSignalExecutionEvidence({ opportunity: { executionEvidence: value } })).toEqual(value);
  });

  it("passes fresh evidence to execution gates", () => {
    const result = toExecutionGateEvidence({ executionEvidence: evidence(10_000) }, 5_000);
    expect(result.structureEvidence?.status).toBe("PASS");
    expect(result.mlDecision).toBe("TRADE");
    expect(result.newsStatus).toBe("OK");
  });

  it("fails closed when evidence has expired", () => {
    const result = toExecutionGateEvidence({ executionEvidence: evidence(4_999) }, 5_000);
    expect(result.structureEvidence?.status).toBe("UNKNOWN");
    expect(result.mlEvidence?.status).toBe("UNKNOWN");
    expect(result.newsStatus).toBe("STALE");
  });
});
