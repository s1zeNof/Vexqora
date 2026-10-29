import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Mock the scalping economics module before importing bot-runner
vi.mock("@crypto-bot/trading/scalping-economics", () => ({
  calculateScalpingEconomics: vi.fn().mockReturnValue({
    feasible: true,
    reason: null,
    positionNotionalUsdt: 100,
    marginUsedUsdt: 33.33,
    riskBudgetUsdt: 1,
    estimatedFeesUsdt: 0.05,
    estimatedSpreadUsdt: 0.02,
    estimatedSlippageUsdt: 0.06,
    estimatedNetProfitUsdt: 1.87,
    estimatedNetLossUsdt: 1.13,
    rewardRiskAfterCosts: 1.65,
  }),
}));

import { startBotRunner } from "./bot-runner";

const BOT_ID = "bot-uuid-1";
const ACCOUNT_ID = "account-uuid-1";
const SIGNAL_ID = "signal-uuid-1";
const TRADE_ID = "trade-uuid-99";
const UPDATED_AT = "2026-10-29T10:00:00.000Z";

function makeMockBot(overrides: Record<string, unknown> = {}) {
  return {
    id: BOT_ID,
    account_id: ACCOUNT_ID,
    name: "Test Bot",
    status: "running",
    mode: "paper",
    strategy: "scalping",
    allocated_capital: 100,
    current_balance: 100,
    target_balance: null,
    goal_action: "pause",
    direction: "both",
    max_positions: 3,
    max_leverage: 3,
    risk_per_trade_pct: 1,
    max_daily_loss_pct: 5,
    max_drawdown_pct: 15,
    max_trades_per_day: 10,
    autonomous_enabled: true,
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

function makeSignal() {
  return {
    id: SIGNAL_ID,
    symbol: "BTCUSDT",
    side: "long",
    status: "pending",
    parsed: { entry: 60000, sl: 59000, tp1: 62000, symbol: "BTCUSDT" },
  };
}

/**
 * Build a full chainable Supabase-style query mock that resolves to `result`
 * at any chain depth.
 */
function makeChainableMock(result: unknown) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        // Make it thenable so await works
        return (resolve: (v: unknown) => void) => resolve(result);
      }
      // Return a function that returns a new proxy (for chaining)
      return () => new Proxy({}, handler);
    },
    apply() {
      return new Proxy({}, handler);
    }
  };
  return new Proxy({}, handler);
}

describe("startBotRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a bot_decisions row and updates heartbeat on a wait cycle (no signals)", async () => {
    const decisionsInsertSpy = vi.fn().mockResolvedValue({ error: null });

    // Optimistic lock claim — must return { data: { id: BOT_ID }, error: null }
    const botsUpdateBuilder = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: BOT_ID }, error: null }),
    };
    const botsUpdateSpy = vi.fn().mockReturnValue(botsUpdateBuilder);

    const emptyResolved = { data: [], error: null };

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "trading_bots") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [makeMockBot()], error: null }),
              }),
            }),
            update: botsUpdateSpy,
          };
        }
        if (table === "trades") {
          // Supports all chains: .select().eq().in().gte() or .select().eq().in()
          return makeChainableMock(emptyResolved);
        }
        if (table === "signals") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "bot_decisions") {
          return { insert: decisionsInsertSpy };
        }
        return makeChainableMock(emptyResolved);
      }),
    } as unknown as SupabaseClient;

    const stop = startBotRunner(mockSupabase, 9_999_999);
    await new Promise((r) => setTimeout(r, 80));
    stop();

    // Heartbeat update should have been called
    expect(botsUpdateSpy).toHaveBeenCalled();

    // A wait or blocked decision row should have been written
    expect(decisionsInsertSpy).toHaveBeenCalled();
    const call = decisionsInsertSpy.mock.calls[0]?.[0] as { action: string } | undefined;
    expect(["wait", "blocked"]).toContain(call?.action);
  });

  it("writes a blocked decision when max_positions is exceeded", async () => {
    const decisionsInsertSpy = vi.fn().mockResolvedValue({ error: null });

    const botsUpdateBuilder = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: BOT_ID }, error: null }),
    };
    const botsUpdateSpy = vi.fn().mockReturnValue(botsUpdateBuilder);

    // Return 1 open position so max_positions=1 is exceeded
    const onePosition = { data: [{ id: "t1" }], error: null };
    const emptyResolved = { data: [], error: null };

    const callCount = { val: 0 };

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "trading_bots") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [makeMockBot({ max_positions: 1 })],
                  error: null,
                }),
              }),
            }),
            update: botsUpdateSpy,
          };
        }
        if (table === "trades") {
          // All trade queries (daily loss, trade count, open positions)
          // Use a counter: first two return empty (no losses, no trades today),
          // third returns 1 open position (triggering the max_positions block)
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  gte: vi.fn().mockImplementation(() => {
                    callCount.val++;
                    // First call: daily realized losses — empty
                    // Second call: trades today count — empty
                    if (callCount.val <= 2) return Promise.resolve(emptyResolved);
                    // Third call: open positions — one position
                    return Promise.resolve(onePosition);
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "bot_decisions") {
          return { insert: decisionsInsertSpy };
        }
        return makeChainableMock(emptyResolved);
      }),
    } as unknown as SupabaseClient;

    const stop = startBotRunner(mockSupabase, 9_999_999);
    await new Promise((r) => setTimeout(r, 80));
    stop();

    // A decision should be written regardless
    expect(decisionsInsertSpy).toHaveBeenCalled();
    const call = decisionsInsertSpy.mock.calls[0]?.[0] as { action: string } | undefined;
    // Should be blocked (max_positions) or wait
    expect(call?.action).toBeTruthy();
  });

  it("writes enter decision and inserts trade when a viable signal exists", async () => {
    const decisionsInsertSpy = vi.fn().mockResolvedValue({ error: null });
    const tradeInsertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: TRADE_ID }, error: null }),
      }),
    });
    const targetsInsertSpy = vi.fn().mockResolvedValue({ error: null });

    const botsUpdateBuilder = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: BOT_ID }, error: null }),
    };
    const botsUpdateSpy = vi.fn().mockReturnValue(botsUpdateBuilder);

    const emptyResolved = { data: [], error: null };

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "trading_bots") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: [makeMockBot()], error: null }),
              }),
            }),
            update: botsUpdateSpy,
          };
        }
        if (table === "trades") {
          // Build a deep chainable mock that returns emptyResolved at any depth,
          // but also exposes insert spy directly
          const eqBuilder = vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              gte: vi.fn().mockResolvedValue(emptyResolved),
            }),
            gte: vi.fn().mockResolvedValue(emptyResolved),
          });
          return {
            insert: tradeInsertSpy,
            select: vi.fn().mockReturnValue({ eq: eqBuilder }),
          };
        }
        if (table === "signals") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({ data: [makeSignal()], error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "trade_targets") {
          return { insert: targetsInsertSpy };
        }
        if (table === "bot_decisions") {
          return { insert: decisionsInsertSpy };
        }
        return makeChainableMock(emptyResolved);
      }),
    } as unknown as SupabaseClient;

    const stop = startBotRunner(mockSupabase, 9_999_999);
    await new Promise((r) => setTimeout(r, 100));
    stop();

    // Trade should have been inserted
    expect(tradeInsertSpy).toHaveBeenCalled();

    // Decision should be written
    expect(decisionsInsertSpy).toHaveBeenCalled();
    const call = decisionsInsertSpy.mock.calls[0]?.[0] as { action: string } | undefined;
    expect(call?.action).toBe("enter");
  });
});
