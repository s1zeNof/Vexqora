import { describe, expect, it } from "vitest";
import {
  evaluatePaperTrade,
  type PaperTradeSnapshot,
  type PaperTargetSnapshot
} from "./paper-engine";

describe("Paper Matching Engine (Pure Emulator)", () => {
  const baseLongTrade: PaperTradeSnapshot = {
    id: "trade-uuid-1",
    symbol: "IRYSUSDT",
    side: "long",
    entry_avg: 0.040,
    qty: 1000,
    leverage: 5,
    sl: 0.038, // -5%
    trailing_stop: {
      distance: { type: "percent", value: 1 },
      activationPrice: 0.045,
      controlMode: "auto",
      initialQty: 1000
    },
    realized_pnl: 0,
    status: "active"
  };

  const baseTargets: PaperTargetSnapshot[] = [
    { id: "tp-1", idx: 1, price: 0.045, share_pct: 40, status: "open" },
    { id: "tp-2", idx: 2, price: 0.048, share_pct: 30, status: "open" },
    { id: "tp-3", idx: 3, price: 0.052, share_pct: 30, status: "open" }
  ];

  it("partially executes TP1 (40%), realizes PnL, and activates trailing stop", () => {
    // Current price crosses TP1 (0.045)
    const result = evaluatePaperTrade(baseLongTrade, baseTargets, 0.0455, 1);

    expect(result.actions).toHaveLength(1);
    const action = result.actions[0]!;
    expect(action.type).toBe("TP_FILLED");
    if (action.type === "TP_FILLED") {
      expect(action.targetIdx).toBe(1);
      expect(action.closedQty).toBe(400); // 40% of 1000
      expect(action.remainingQty).toBe(600);
      expect(action.realizedPnl).toBeCloseTo((0.045 - 0.040) * 400); // +2 USDT
      expect(action.updatedTrailingStop.activated).toBe(true);
      expect(action.updatedTrailingStop.highestPrice).toBe(0.0455);
    }

    expect(result.updatedTrade.qty).toBe(600);
    expect(result.updatedTrade.realized_pnl).toBeCloseTo(2);
    expect(result.updatedTrade.status).toBe("active");
    expect(result.updatedTargets).toEqual([
      expect.objectContaining({ id: "tp-1", status: "filled" })
    ]);
  });

  it("handles sequential TP2 (30%) and TP3 (30%) closing the position completely", () => {
    // After TP1, remaining qty is 600
    const tradeAfterTp1: PaperTradeSnapshot = {
      ...baseLongTrade,
      qty: 600,
      realized_pnl: 2,
      trailing_stop: {
        distance: { type: "percent", value: 1 },
        activated: true,
        highestPrice: 0.046,
        controlMode: "auto",
        initialQty: 1000
      }
    };
    const targetsAfterTp1: PaperTargetSnapshot[] = [
      { id: "tp-1", idx: 1, price: 0.045, share_pct: 40, status: "filled" },
      { id: "tp-2", idx: 2, price: 0.048, share_pct: 30, status: "open" },
      { id: "tp-3", idx: 3, price: 0.052, share_pct: 30, status: "open" }
    ];

    // Price skyrockets to 0.055, hitting both TP2 and TP3
    const result = evaluatePaperTrade(tradeAfterTp1, targetsAfterTp1, 0.055, 1);

    expect(result.actions).toHaveLength(2);
    expect(result.actions[0]?.type).toBe("TP_FILLED");
    expect(result.actions[1]?.type).toBe("TP_FILLED");

    expect(result.updatedTrade.status).toBe("closed");
    expect(result.updatedTrade.qty).toBe(0);
    // TP2: (0.048 - 0.040) * 300 = 2.4 USDT
    // TP3: (0.052 - 0.040) * 300 = 3.6 USDT
    // Total delta: 6.0 USDT
    expect(result.totalRealizedPnlDelta).toBeCloseTo(6.0);
    expect(result.updatedTrade.realized_pnl).toBeCloseTo(8.0); // 2 + 6
  });

  it("triggers dynamic trailing stop when price rolls back 1% from peak after TP1", () => {
    // Trade has TP1 filled, peak was at 0.047
    const tradeActive: PaperTradeSnapshot = {
      ...baseLongTrade,
      qty: 600,
      realized_pnl: 2,
      trailing_stop: {
        distance: { type: "percent", value: 1 }, // 1%
        activated: true,
        highestPrice: 0.050, // Peak reached 0.050
        controlMode: "auto",
        initialQty: 1000
      }
    };
    const targets: PaperTargetSnapshot[] = [
      { id: "tp-1", idx: 1, price: 0.045, share_pct: 40, status: "filled" },
      { id: "tp-2", idx: 2, price: 0.055, share_pct: 30, status: "open" },
      { id: "tp-3", idx: 3, price: 0.060, share_pct: 30, status: "open" }
    ];

    // 1% pullback from 0.050 is 0.050 * 0.99 = 0.0495.
    // Price drops to 0.0494 (below trigger)
    const result = evaluatePaperTrade(tradeActive, targets, 0.0494, 1);

    expect(result.actions).toHaveLength(1);
    const action = result.actions[0]!;
    expect(action.type).toBe("TRAILING_STOP_TRIGGERED");
    if (action.type === "TRAILING_STOP_TRIGGERED") {
      expect(action.triggerPrice).toBeCloseTo(0.0495);
      expect(action.closedQty).toBe(600);
      expect(action.realizedPnl).toBeCloseTo((0.0494 - 0.040) * 600);
    }

    expect(result.updatedTrade.status).toBe("closed");
    expect(result.updatedTrade.qty).toBe(0);
    // Unfilled targets cancelled
    expect(result.updatedTargets).toEqual(
      expect.arrayContaining([
        { id: "tp-2", status: "cancelled" },
        { id: "tp-3", status: "cancelled" }
      ])
    );
  });

  it("triggers stop loss immediately if price breaches SL", () => {
    // SL is at 0.038. Price crashes to 0.0375
    const result = evaluatePaperTrade(baseLongTrade, baseTargets, 0.0375, 1);

    expect(result.actions).toHaveLength(1);
    const action = result.actions[0]!;
    expect(action.type).toBe("STOP_LOSS_TRIGGERED");
    if (action.type === "STOP_LOSS_TRIGGERED") {
      expect(action.closedQty).toBe(1000);
      expect(action.realizedPnl).toBeCloseTo((0.0375 - 0.040) * 1000); // -2.5 USDT
    }

    expect(result.updatedTrade.status).toBe("closed");
    expect(result.updatedTrade.qty).toBe(0);
    expect(result.updatedTrade.realized_pnl).toBeCloseTo(-2.5);
    expect(result.updatedTargets).toHaveLength(3);
    expect(result.updatedTargets.every((t) => t.status === "cancelled")).toBe(true);
  });

  it("pauses automated closures when in Manual mode (controlMode: 'manual')", () => {
    const manualTrade: PaperTradeSnapshot = {
      ...baseLongTrade,
      trailing_stop: {
        distance: { type: "percent", value: 1 },
        controlMode: "manual",
        initialQty: 1000
      }
    };

    // Price hits TP1 (0.045) or falls below SL (0.037)
    const tpResult = evaluatePaperTrade(manualTrade, baseTargets, 0.046, 1);
    expect(tpResult.updatedTrade.status).toBe("active");
    expect(tpResult.updatedTrade.qty).toBe(1000);
    expect(tpResult.totalRealizedPnlDelta).toBe(0);
    // Peak should be tracked but no TP filled
    expect(tpResult.updatedTargets).toHaveLength(0);

    const slResult = evaluatePaperTrade(manualTrade, baseTargets, 0.035, 1);
    expect(slResult.updatedTrade.status).toBe("active");
    expect(slResult.updatedTrade.qty).toBe(1000);
    expect(slResult.totalRealizedPnlDelta).toBe(0);
  });

  it("handles short trade TP, SL, and trailing stop properly", () => {
    const shortTrade: PaperTradeSnapshot = {
      id: "trade-short",
      symbol: "ETHUSDT",
      side: "short",
      entry_avg: 2500,
      qty: 2,
      leverage: 10,
      sl: 2550, // SL higher than entry
      trailing_stop: {
        distance: { type: "percent", value: 1 },
        controlMode: "auto",
        initialQty: 2
      },
      realized_pnl: 0,
      status: "active"
    };

    const shortTargets: PaperTargetSnapshot[] = [
      { id: "tp-s1", idx: 1, price: 2450, share_pct: 40, status: "open" },
      { id: "tp-s2", idx: 2, price: 2400, share_pct: 60, status: "open" }
    ];

    // Price drops to 2440 (crosses TP1)
    const result = evaluatePaperTrade(shortTrade, shortTargets, 2440, 0.1);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.type).toBe("TP_FILLED");
    if (result.actions[0]?.type === "TP_FILLED") {
      expect(result.actions[0].closedQty).toBeCloseTo(0.8); // 40% of 2
      expect(result.actions[0].remainingQty).toBeCloseTo(1.2);
      expect(result.actions[0].realizedPnl).toBeCloseTo((2500 - 2450) * 0.8); // +40 USDT
      expect(result.actions[0].updatedTrailingStop.lowestPrice).toBe(2440);
    }
  });

  it("preserves partial TP sizing for fractional crypto quantity when qty step is unavailable", () => {
    const fractionalTrade: PaperTradeSnapshot = {
      ...baseLongTrade,
      symbol: "BTCUSDT",
      entry_avg: 100_000,
      qty: 0.01,
      sl: 98_000,
      trailing_stop: { controlMode: "auto", initialQty: 0.01 },
      realized_pnl: 0
    };
    const targets: PaperTargetSnapshot[] = [
      { id: "btc-tp-1", idx: 1, price: 101_000, share_pct: 40, status: "open" },
      { id: "btc-tp-2", idx: 2, price: 102_000, share_pct: 60, status: "open" }
    ];

    const result = evaluatePaperTrade(fractionalTrade, targets, 101_100);

    expect(result.updatedTrade.status).toBe("active");
    expect(result.updatedTrade.qty).toBeCloseTo(0.006);
    expect(result.totalRealizedPnlDelta).toBeCloseTo(4);
  });

  it("records the exact automatic exit reason and execution zone", () => {
    const result = evaluatePaperTrade(baseLongTrade, baseTargets, 0.0375, 1);

    expect(result.updatedTrade.exit).toEqual({
      reason: "stop_loss",
      price: 0.0375,
      details: { configuredStopLoss: 0.038, closedQty: 1000 }
    });
  });
});
