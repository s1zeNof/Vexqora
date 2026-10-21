import { describe, expect, it, vi } from "vitest";
import { processJob, type ExecutionJobData } from "./runner";
import { encryptSecret } from "@crypto-bot/exchange";
import type { SupabaseClient } from "@supabase/supabase-js";

const masterKey = "pyU8Aa7fc5SoSt3oqwibpX3z9ZAi5HhmR+vtP/cCG18=";

describe("processJob", () => {
  it("rejects execution immediately if Emergency Kill Switch is active", async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "risk_settings") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { kill_switch: true, max_open_positions: 3, risk_per_trade_pct: 1 },
              error: null
            })
          };
        }
        return {};
      })
    };

    const job: ExecutionJobData = {
      job_id: "job-1",
      account_id: "acc-1",
      signal_id: "sig-1",
      attempt_count: 0,
      signal_parsed: {
        symbol: "BTCUSDT",
        side: "long",
        entry: { type: "market" },
        stopLoss: 64000,
        takeProfits: [{ price: 67000, sharePct: 100 }],
        source: "chat"
      },
      signal_raw: "BTCUSDT LONG market",
      exchange_kind: "bybit",
      exchange_env: "demo",
      api_key_enc: encryptSecret("mock-key-12345", masterKey),
      api_secret_enc: encryptSecret("mock-secret-12345", masterKey)
    };

    await expect(
      processJob(mockSupabase as unknown as SupabaseClient, job, masterKey)
    ).rejects.toThrow("Emergency Kill Switch is ACTIVE");
  });

  it("rejects execution if max open positions limit is reached", async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "risk_settings") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { kill_switch: false, max_open_positions: 2, risk_per_trade_pct: 1 },
              error: null
            })
          };
        }
        if (table === "trades") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: (resolve: (val: unknown) => void) => {
              resolve({ count: 2, error: null });
            }
          };
        }
        return {};
      })
    };

    const job: ExecutionJobData = {
      job_id: "job-2",
      account_id: "acc-1",
      signal_id: "sig-2",
      attempt_count: 0,
      signal_parsed: {
        symbol: "ETHUSDT",
        side: "short",
        entry: { type: "market" },
        stopLoss: 3500,
        takeProfits: [{ price: 3200, sharePct: 100 }],
        source: "chat"
      },
      signal_raw: "ETHUSDT SHORT market",
      exchange_kind: "bybit",
      exchange_env: "demo",
      api_key_enc: encryptSecret("mock-key-12345", masterKey),
      api_secret_enc: encryptSecret("mock-secret-12345", masterKey)
    };

    await expect(
      processJob(mockSupabase as unknown as SupabaseClient, job, masterKey)
    ).rejects.toThrow("Open positions limit");
  });
});
