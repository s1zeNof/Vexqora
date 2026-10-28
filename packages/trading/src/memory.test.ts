import { describe, expect, it } from "vitest";
import { findHistoricalPatternMatch } from "./memory";

describe("Vexqora Memory", () => {
  it("matches liquidity sweep setups with historical catalog without fake empirical claims", () => {
    const match = findHistoricalPatternMatch("BTCUSDT", "liquidity_sweep", 2.2);
    expect(match.patternId).toBe("pat-liq-sweep-choch");
    expect(match.sampleCount).toBeNull();
    expect(match.winRatePct).toBeNull();
    expect(match.provenance).toBe("heuristic");
    expect(match.isEmpirical).toBe(false);
    expect(match.historicalContext).toContain("Heuristic setup");
    expect(match.historicalContext).not.toContain("37 historical episodes");
  });

  it("matches parabolic volume climax spikes with mean reversion and null win rates", () => {
    const match = findHistoricalPatternMatch("DOGEUSDT", "price_spike", 4.8);
    expect(match.patternId).toBe("pat-exhaustion-revert");
    expect(match.sampleCount).toBeNull();
    expect(match.winRatePct).toBeNull();
    expect(match.provenance).toBe("heuristic");
  });

  it("returns discretionary unconfirmed fallback when no SMC pattern matches with null winRate", () => {
    const match = findHistoricalPatternMatch("RANDOMCOIN", "normal_tick", 0.2);
    expect(match.patternId).toBe("pat-discretionary");
    expect(match.isEmpirical).toBe(false);
    expect(match.provenance).toBe("heuristic");
    expect(match.winRatePct).toBeNull();
    expect(match.sampleCount).toBeNull();
  });
});
