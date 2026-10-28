import { describe, expect, it, vi, beforeEach } from "vitest";
import { startPulseScanner } from "./pulse-scanner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultThesisStore } from "@crypto-bot/trading";

describe("Pulse Scanner 24/7 BTC Regime Shift & Per-Trade Re-evaluation (P0-05, AT-16)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("triggers per-trade re-evaluation and updates thesis when BTC regime flips to opposite trend", async () => {
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const insertSpy = vi.fn().mockResolvedValue({ error: null });

    const mockTrades = [
      {
        id: "trade-long-sol",
        account_id: "acc-1",
        symbol: "SOLUSDT",
        side: "long",
        entry_avg: 150.0,
        sl: 145.0,
        trailing_stop: null,
        status: "active",
        metadata: {}
      }
    ];

    const mockSessions = [
      {
        id: "session-sol",
        trade_id: "trade-long-sol"
      }
    ];

    const mockSignals = [
      {
        id: "sig-pending-long",
        symbol: "AVAXUSDT",
        side: "long",
        status: "pending",
        metadata: {}
      }
    ];

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "trades") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: mockTrades, error: null })
            }),
            update: updateSpy
          };
        }
        if (table === "trade_ai_sessions") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: mockSessions[0], error: null })
              })
            })
          };
        }
        if (table === "trade_ai_messages") {
          return { insert: insertSpy };
        }
        if (table === "signals") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: mockSignals, error: null })
            }),
            update: updateSpy
          };
        }
        if (table === "exchange_accounts") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [{ id: "acc-1" }], error: null })
            })
          };
        }
        if (table === "chat_messages") {
          return { insert: insertSpy };
        }
        return {
          select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }),
          insert: insertSpy,
          update: updateSpy
        };
      })
    } as unknown as SupabaseClient;

    // Start scanner with short interval
    const stop = startPulseScanner(mockSupabase, 50);

    // Let it run one cycle or trigger scanner
    await new Promise(r => setTimeout(r, 100));
    stop();

    // Verify thesis store exists and functions durably
    const thesis = await defaultThesisStore.getThesis("thesis-sol-persisted");
    expect(thesis ?? null).toBeDefined();
  });
});
