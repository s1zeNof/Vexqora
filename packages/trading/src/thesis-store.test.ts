import { describe, expect, it } from "vitest";
import { DurableTradeThesisStore, type TradeThesis } from "./thesis-store";
import path from "node:path";
import os from "node:os";

describe("Durable Trade Thesis Store (P0-08, AT-08 Persistence)", () => {
  const tmpDir = path.join(os.tmpdir(), `vexqora-thesis-test-${Date.now()}`);
  const store = new DurableTradeThesisStore({ storageDir: tmpDir });

  const baseThesis: TradeThesis = {
    thesisId: "thesis-sol-persisted",
    symbol: "SOLUSDT",
    side: "long",
    status: "VALID",
    revision: 1,
    entryPrice: 150.0,
    invalidationPrice: 145.0,
    primaryRationale: "Bullish order block support",
    invalidationTrigger: "Close below 145",
    supportingEvidence: ["4H bullish structure", "CVD delta positive"],
    opposingEvidence: [],
    createdAtMs: 1700000000000,
    updatedAtMs: 1700000000000
  };

  it("saves initial thesis with revision 1", async () => {
    const saved = await store.saveThesis(baseThesis);
    expect(saved.revision).toBe(1);
    expect(saved.status).toBe("VALID");

    const retrieved = await store.getThesis("thesis-sol-persisted");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.symbol).toBe("SOLUSDT");
  });

  it("increments revision and tracks diff when thesis is updated on contradiction", async () => {
    const updatedThesis: TradeThesis = {
      ...baseThesis,
      status: "WEAKENED",
      invalidationPrice: 147.0,
      opposingEvidence: ["BTC regime flipped to bearish", "Negative tape CVD"]
    };

    const savedRev2 = await store.saveThesis(updatedThesis);
    expect(savedRev2.revision).toBe(2);
    expect(savedRev2.status).toBe("WEAKENED");
    expect(savedRev2.diffFromPrevious).toBeDefined();
    expect(savedRev2.diffFromPrevious?.statusChanged).toBe(true);
    expect(savedRev2.diffFromPrevious?.previousStatus).toBe("VALID");
    expect(savedRev2.diffFromPrevious?.newStatus).toBe("WEAKENED");
    expect(savedRev2.diffFromPrevious?.addedOpposingEvidence.length).toBe(2);
    expect(savedRev2.diffFromPrevious?.summary).toContain("Status: VALID -> WEAKENED");
  });

  it("persists across memory cache eviction (reloads from durable file storage)", async () => {
    // Clear in-memory Map
    store.clearMemoryCache();

    // Fetch should read from disk
    const reloaded = await store.getThesis("thesis-sol-persisted");
    expect(reloaded).not.toBeNull();
    expect(reloaded?.revision).toBe(2);
    expect(reloaded?.status).toBe("WEAKENED");
    expect(reloaded?.invalidationPrice).toBe(147.0);

    const history = await store.getThesisHistory("thesis-sol-persisted");
    expect(history.length).toBe(2);
    expect(history[0]?.revision).toBe(1);
    expect(history[1]?.revision).toBe(2);
  });
});
