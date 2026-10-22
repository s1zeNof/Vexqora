import { describe, expect, it, vi } from "vitest";
import { handleBybitUserEvent } from "./ws-listener";
import type { ExchangeClient, UserEvent } from "@crypto-bot/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

interface TableMockHandler {
  data?: unknown;
  listData?: unknown[];
  insert?: (val: unknown) => void;
  update?: (val: unknown) => void;
}

function createMockSupabase(handlers: Record<string, TableMockHandler>) {
  return {
    from: vi.fn((table: string) => {
      const tableHandler = handlers[table] ?? {};
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn(() => chain);
      chain.insert = vi.fn((val: unknown) => {
        tableHandler.insert?.(val);
        return Promise.resolve({ data: val, error: null });
      });
      chain.update = vi.fn((val: unknown) => {
        tableHandler.update?.(val);
        return chain;
      });
      chain.eq = vi.fn(() => chain);
      chain.or = vi.fn(() => chain);
      chain.single = vi.fn(() => Promise.resolve({ data: tableHandler.data ?? null, error: null }));
      chain.maybeSingle = vi.fn(() => Promise.resolve({ data: tableHandler.data ?? null, error: null }));
      chain.then = (resolve: (val: unknown) => void) => {
        resolve({ data: tableHandler.listData ?? [], error: null });
      };
      return chain;
    })
  } as unknown as SupabaseClient;
}


describe("handleBybitUserEvent", () => {
  it("transitions trade to active and sets protection when entry limit order fills", async () => {
    const updateTradeMock = vi.fn();
    const updateOrderMock = vi.fn();
    const insertTargetMock = vi.fn();
    const insertChatMock = vi.fn();

    const mockSupabase = createMockSupabase({
      orders: {
        data: {
          id: "ord-1",
          trade_id: "trade-1",
          reduce_only: false,
          type: "limit",
          status: "submitted",
          raw: {
            preview: {
              signal: {
                symbol: "BTCUSDT",
                side: "long",
                entry: { type: "limit", price: 65000 },
                stopLoss: 63000,
                takeProfits: [{ price: 68000, sharePct: 100 }],
                source: "chat"
              },
              entryPrice: 65000,
              qty: 0.1,
              qtyStep: 0.001,
              tickSize: 0.1,
              notional: 6500,
              riskAmount: 200,
              riskPct: 2,
              leverage: 5,
              weightedRewardRisk: 1.5
            }
          }
        },
        update: updateOrderMock
      },
      trades: {
        data: {
          id: "trade-1",
          symbol: "BTCUSDT",
          side: "long",
          status: "entry_open",
          qty: 0.1,
          sl: 63000,
          leverage: 5
        },
        update: updateTradeMock
      },
      trade_targets: {
        insert: insertTargetMock
      },
      chat_messages: {
        insert: insertChatMock
      }
    });

    const mockClient: Partial<ExchangeClient> = {
      setTradingStop: vi.fn().mockResolvedValue(undefined),
      placeOrder: vi.fn().mockResolvedValue({ orderId: "bybit-tp-1", orderLinkId: "tp-trade-1-1" })
    };

    const event: UserEvent = {
      type: "bybit",
      payload: {
        topic: "order",
        data: [
          {
            symbol: "BTCUSDT",
            orderId: "bybit-entry-1",
            orderLinkId: "entry-trade-1",
            orderStatus: "Filled",
            avgPrice: "65000",
            cumExecQty: "0.1",
            reduceOnly: false
          }
        ]
      }
    };

    await handleBybitUserEvent(
      mockSupabase,
      mockClient as unknown as ExchangeClient,
      { id: "acc-1", label: "Bybit Demo" },
      event
    );

    expect(updateTradeMock).toHaveBeenCalledWith(expect.objectContaining({
      status: "active",
      entry_avg: 65000
    }));

    expect(mockClient.setTradingStop).toHaveBeenCalledWith(expect.objectContaining({
      symbol: "BTCUSDT",
      stopLoss: 63000
    }));

    expect(mockClient.placeOrder).toHaveBeenCalledWith(expect.objectContaining({
      symbol: "BTCUSDT",
      side: "sell",
      type: "limit",
      price: 68000,
      reduceOnly: true
    }));

    expect(insertChatMock).toHaveBeenCalled();
  });

  it("marks trade target filled and closes trade when all targets are hit", async () => {
    const updateTargetMock = vi.fn();
    const updateTradeMock = vi.fn();

    const mockSupabase = createMockSupabase({
      orders: {
        data: {
          id: "ord-tp-1",
          trade_id: "trade-1",
          reduce_only: true,
          type: "limit",
          status: "submitted"
        }
      },
      trade_targets: {
        data: {
          id: "target-1",
          trade_id: "trade-1",
          idx: 1,
          price: 68000
        },
        listData: [], // 0 remaining open targets
        update: updateTargetMock
      },
      trades: {
        update: updateTradeMock
      },
      chat_messages: {
        insert: vi.fn()
      }
    });

    const mockClient: Partial<ExchangeClient> = {};

    const event: UserEvent = {
      type: "bybit",
      payload: {
        topic: "order",
        data: [
          {
            symbol: "BTCUSDT",
            orderId: "bybit-tp-1",
            orderLinkId: "tp-trade-1-1",
            orderStatus: "Filled",
            avgPrice: "68000",
            reduceOnly: true
          }
        ]
      }
    };

    await handleBybitUserEvent(
      mockSupabase,
      mockClient as unknown as ExchangeClient,
      { id: "acc-1", label: "Bybit Demo" },
      event
    );

    expect(updateTargetMock).toHaveBeenCalledWith(expect.objectContaining({
      status: "filled"
    }));

    expect(updateTradeMock).toHaveBeenCalledWith(expect.objectContaining({
      status: "closed"
    }));
  });

  it("closes active trade and cancels remaining orders when position size drops to 0", async () => {
    const updateTradeMock = vi.fn();
    const cancelOrderMock = vi.fn().mockResolvedValue(undefined);

    const mockSupabase = createMockSupabase({
      trades: {
        listData: [{ id: "trade-1", symbol: "BTCUSDT" }],
        update: updateTradeMock
      },
      trade_targets: {
        update: vi.fn()
      },
      chat_messages: {
        insert: vi.fn()
      }
    });

    const mockClient: Partial<ExchangeClient> = {
      getOpenOrders: vi.fn().mockResolvedValue([{ orderId: "rem-1", symbol: "BTCUSDT", status: "New" }]),
      cancelOrder: cancelOrderMock
    };

    const event: UserEvent = {
      type: "bybit",
      payload: {
        topic: "position",
        data: [
          {
            symbol: "BTCUSDT",
            size: "0"
          }
        ]
      }
    };

    await handleBybitUserEvent(
      mockSupabase,
      mockClient as unknown as ExchangeClient,
      { id: "acc-1", label: "Bybit Demo" },
      event
    );

    expect(updateTradeMock).toHaveBeenCalledWith(expect.objectContaining({
      status: "closed"
    }));

    expect(cancelOrderMock).toHaveBeenCalledWith("BTCUSDT", "rem-1");
  });
});
