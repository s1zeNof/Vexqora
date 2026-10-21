import { describe, expect, it } from "vitest";
import { signalSchema } from "./signal";

describe("signalSchema", () => {
  it("accepts a valid multi-target signal", () => {
    const result = signalSchema.safeParse({
      symbol: "btcusdt",
      side: "long",
      entry: { type: "limit", price: 65_000 },
      stopLoss: 64_000,
      takeProfits: [
        { price: 66_000, sharePct: 40 },
        { price: 67_000, sharePct: 60 }
      ],
      source: "chat"
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.symbol).toBe("BTCUSDT");
  });

  it("rejects target shares that do not total 100", () => {
    const result = signalSchema.safeParse({
      symbol: "BTCUSDT",
      side: "long",
      entry: { type: "market" },
      stopLoss: 64_000,
      takeProfits: [{ price: 66_000, sharePct: 50 }],
      source: "chat"
    });
    expect(result.success).toBe(false);
  });
});

