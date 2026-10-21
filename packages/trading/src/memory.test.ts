import { describe, expect, it } from "vitest";
import { findHistoricalPatternMatch } from "./memory";

describe("Vexqora Memory", () => {
  it("matches liquidity sweep setups with historical catalog", () => {
    const match = findHistoricalPatternMatch("BTCUSDT", "liquidity_sweep", 2.2);
    expect(match.patternId).toBe("pat-liq-sweep-choch");
    expect(match.sampleCount).toBe(37);
    expect(match.winRatePct).toBe(73.0);
    expect(match.historicalContext).toContain("37 historical episodes");
  });

  it("matches parabolic volume climax spikes with mean reversion", () => {
    const match = findHistoricalPatternMatch("DOGEUSDT", "price_spike", 4.8);
    expect(match.patternId).toBe("pat-exhaustion-revert");
    expect(match.sampleCount).toBe(34);
    expect(match.winRatePct).toBe(70.6);
  });
});
