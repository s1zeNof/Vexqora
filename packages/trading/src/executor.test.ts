import type { ExchangeClient, OrderAck, OrderRequest, TradingStopParams } from "@crypto-bot/shared";
import { describe, expect, it, vi } from "vitest";
import { protectFilledPosition, reduceTradeStatus, submitEntry } from "./executor";
import type { TradePreview } from "./risk";

function mockClient(label: string) {
  const calls: unknown[] = [];
  const client: ExchangeClient = {
    capabilities: { requestDemoFunds: label === "demo", nativeTrailingStop: true },
    getBalance: vi.fn(), getInstrument: vi.fn(), getTicker: vi.fn(), cancelOrder: vi.fn(),
    getPositions: vi.fn(), getOpenOrders: vi.fn(), closePosition: vi.fn(), subscribeUserStream: vi.fn(),
    setLeverage: vi.fn((symbol: string, leverage: number) => { calls.push(["setLeverage", symbol, leverage]); return Promise.resolve(); }),
    placeOrder: vi.fn((order: OrderRequest): Promise<OrderAck> => {
      calls.push(["placeOrder", order]);
      return Promise.resolve({ orderId: `order-${calls.length}`, orderLinkId: order.orderLinkId });
    }),
    setTradingStop: vi.fn((params: TradingStopParams) => { calls.push(["setTradingStop", params]); return Promise.resolve(); })
  };
  return { client, calls };
}

const preview: TradePreview = {
  signal: {
    symbol: "BTCUSDT", side: "long", entry: { type: "limit", price: 65_000 }, stopLoss: 64_000,
    takeProfits: [{ price: 66_000, sharePct: 40 }, { price: 67_000, sharePct: 60 }], source: "chat"
  },
  entryPrice: 65_000, qty: 0.1, qtyStep: 0.001, tickSize: 0.1, notional: 6_500, riskAmount: 100, riskPct: 1, leverage: 5, weightedRewardRisk: 1.6
};

describe("executor", () => {
  const verifiedOptions = {
    evidence: {
      structureTrend: "bullish" as const,
      evUsd: 15.0,
      hasCriticalNews: false,
      newsStatus: "OK" as const
    }
  };

  it("uses the exact same execution sequence for demo and live clients", async () => {
    const demo = mockClient("demo");
    const live = mockClient("live");
    await submitEntry(demo.client, preview, "trade-1", verifiedOptions);
    await protectFilledPosition(demo.client, preview, "trade-1");
    await submitEntry(live.client, preview, "trade-1", verifiedOptions);
    await protectFilledPosition(live.client, preview, "trade-1");
    expect(demo.calls).toEqual(live.calls);
  });

  it("fails-closed by default if caller provides no verified evidence, and does not call placeOrder", async () => {
    const mock = mockClient("live");
    await expect(submitEntry(mock.client, preview, "trade-no-evidence")).rejects.toThrow(
      "Execution blocked by Decision Ensemble Gate: Gate 1 (Structure)"
    );
    expect(mock.calls).toHaveLength(0);
  });

  it("places stop protection before reduce-only targets", async () => {
    const mock = mockClient("demo");
    await protectFilledPosition(mock.client, preview, "trade-1");
    expect(mock.calls[0]).toEqual(["setTradingStop", { symbol: "BTCUSDT", stopLoss: 64_000 }]);
    expect(mock.calls).toHaveLength(3);
    expect(mock.calls[1]).toMatchObject(["placeOrder", { reduceOnly: true, qty: 0.04 }]);
    expect(mock.calls[2]).toMatchObject(["placeOrder", { reduceOnly: true, qty: 0.06 }]);
  });

  it("rejects invalid state transitions", () => {
    expect(reduceTradeStatus("pending", { type: "ENTRY_SUBMITTED" })).toBe("entry_open");
    expect(reduceTradeStatus("entry_open", { type: "ENTRY_FILLED" })).toBe("active");
    expect(() => reduceTradeStatus("closed", { type: "ENTRY_FILLED" })).toThrow("Invalid trade transition");
  });

  it("only enables trailing stop with activePrice (TP1 level) to prevent immediate exit on fill", async () => {
    const mock = mockClient("live");
    const previewWithTrail: TradePreview = {
      ...preview,
      signal: {
        ...preview.signal,
        trailingStop: { distance: { type: "percent", value: 1 } }
      }
    };
    await protectFilledPosition(mock.client, previewWithTrail, "trade-2");
    expect(mock.calls[0]).toEqual(["setTradingStop", {
      symbol: "BTCUSDT",
      stopLoss: 64_000,
      activePrice: 66_000,
      trailingStop: 650
    }]);
  });

  it("strictly blocks order execution on backend if 4-gate ensemble check fails", async () => {
    const mock = mockClient("live");
    const badPreview: TradePreview = {
      ...preview,
      weightedRewardRisk: 0.5,
      signal: {
        ...preview.signal,
        stopLoss: 66_000
      }
    };

    await expect(submitEntry(mock.client, badPreview, "trade-bad")).rejects.toThrow(
      "Execution blocked by Decision Ensemble Gate"
    );
    expect(mock.calls).toHaveLength(0);
  });
});
