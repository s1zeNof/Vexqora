import { describe, expect, it } from "vitest";
import { calculateAdaptiveConfidence } from "./ai-learning";

describe("calculateAdaptiveConfidence (Adaptive Risk Feedback Loop)", () => {
  it("heavily penalizes overextended longs after major pump and tags provenance as heuristic", () => {
    // Exactly as seen in user's BMTUSDT (+48.40% 24h gain)
    const result = calculateAdaptiveConfidence({
      symbol: "BMTUSDT",
      side: "long",
      change24hPct: 48.4,
      baseScore: 73
    });

    expect(result.confidencePct).toBeLessThanOrEqual(51);
    expect(result.isHighRisk).toBe(true);
    expect(result.qualityTier).toMatch(/^(C|High Risk)$/);
    expect(result.penalties.some(p => p.reason.includes("Надмірний перегрів"))).toBe(true);
    expect(result.decision).toBe("NO_TRADE");
    expect(result.rejectionReason).toBeDefined();
    expect(result.provenance).toBe("heuristic");
    expect(result.calibratedProbability).toBeNull();
  });

  it("applies loss penalty from previous stop losses on the same symbol", () => {
    const result = calculateAdaptiveConfidence({
      symbol: "BMTUSDT",
      side: "long",
      change24hPct: 10,
      baseScore: 73,
      recentLossesCount: 2
    });

    expect(result.confidencePct).toBeLessThan(60);
    expect(result.penalties.some(p => p.reason.includes("Memory Feedback: 2 нещодавні інвалідації"))).toBe(true);
    expect(result.decision).toMatch(/^(NO_TRADE|WAIT_FOR_CONFIRMATION)$/);
    expect(result.provenance).toBe("heuristic");
    expect(result.calibratedProbability).toBeNull();
  });

  it("maintains high score for healthy setups with no overextension or recent losses", () => {
    const result = calculateAdaptiveConfidence({
      symbol: "BTCUSDT",
      side: "long",
      change24hPct: 2.5,
      baseScore: 73,
      recentLossesCount: 0,
      recentWinsCount: 2
    });

    expect(result.confidencePct).toBeGreaterThanOrEqual(73);
    expect(result.qualityTier).toMatch(/^(A|A\+)$/);
    expect(result.isHighRisk).toBe(false);
    expect(result.decision).toBe("TRADE");
    expect(result.provenance).toBe("heuristic");
    expect(result.calibratedProbability).toBeNull();
  });
});
