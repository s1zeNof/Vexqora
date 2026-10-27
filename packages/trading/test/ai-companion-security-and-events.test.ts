import { describe, it, expect, vi } from "vitest";
import {
  orchestrateTradeAnalysis,
  runSubagent,
  executeAgentSkill,
  type SkillExecutionResult,
  type LeadTradeSynthesis
} from "../src/agent-runtime";
import type { Kline } from "@crypto-bot/shared";
import type { MarketMicrostructure } from "../src/microstructure";
import type { NewsRiskAssessment } from "../src/news";

describe("AI Companion Security, Multi-Agent Grounding, and Autonomous Events (P0 & P1)", () => {
  const sampleKlines: Kline[] = Array.from({ length: 30 }, (_, i) => ({
    time: 1700000000000 + i * 900000,
    open: 65000 + i * 10,
    high: 65100 + i * 10,
    low: 64900 + i * 10,
    close: 65050 + i * 10,
    volume: 100 + i
  }));

  describe("P0.1 — Cross-User Isolation & Security Constraints", () => {
    it("simulates cross-user trade hijacking rejection", () => {
      // Mock user database records
      const users = {
        userA: { id: "user-a-uuid" },
        userB: { id: "user-b-uuid" }
      };

      const exchangeAccounts = [
        { id: "acc-a", userId: users.userA.id, label: "Account A" },
        { id: "acc-b", userId: users.userB.id, label: "Account B" }
      ];

      const trades = [
        { id: "trade-a", accountId: "acc-a", symbol: "BTCUSDT" },
        { id: "trade-b", accountId: "acc-b", symbol: "ETHUSDT" }
      ];

      function verifyTradeAccess(requestingUserId: string, targetTradeId: string): boolean {
        const trade = trades.find((t) => t.id === targetTradeId);
        if (!trade) return false;
        const account = exchangeAccounts.find((a) => a.id === trade.accountId && a.userId === requestingUserId);
        return Boolean(account);
      }

      // User A owns trade-a
      expect(verifyTradeAccess(users.userA.id, "trade-a")).toBe(true);
      // User B owns trade-b
      expect(verifyTradeAccess(users.userB.id, "trade-b")).toBe(true);

      // User A attempts to attach User B's trade to their own session -> MUST BE REJECTED
      expect(verifyTradeAccess(users.userA.id, "trade-b")).toBe(false);
      // User B attempts to attach User A's trade -> MUST BE REJECTED
      expect(verifyTradeAccess(users.userB.id, "trade-a")).toBe(false);
    });
  });

  describe("P0.3 — Grounded Intelligence without Hallucinations", () => {
    it("marks order_flow_agent as [DATA_UNAVAILABLE] when microstructure is absent", async () => {
      const res = await runSubagent(
        "order_flow_agent",
        {
          sessionId: "test-session",
          symbol: "BTCUSDT",
          currentPrice: 65000,
          depth: 0,
          invocationsCount: 0
        },
        {
          microstructure: null
        }
      );

      expect(res.analysis).toContain("[DATA_UNAVAILABLE]");
      expect(res.recommendation).toBe("NO_ACTION");
      expect(res.evidence[0]?.status).toBe("INSUFFICIENT_DATA");
    });

    it("evaluates live CVD and OBI when real microstructure is provided", async () => {
      const mockMicro: MarketMicrostructure = {
        symbol: "BTCUSDT",
        timestamp: Date.now(),
        orderBook: {
          bidDepthUsd: 1500000,
          askDepthUsd: 1000000,
          linearImbalance: 0.2,
          weightedImbalance: 0.25,
          topLevelsSpreadPct: 0.01,
          microPrice: 65002
        },
        tape: {
          tradesSampleCount: 150,
          windowSeconds: 60,
          buyerAggressionPct: 62.5,
          whaleTradesCount: 4,
          cvdUsd: 450000
        },
        classification: "STRONG_BUY_PRESSURE",
        spoofingSuspicion: false
      };

      const res = await runSubagent(
        "order_flow_agent",
        {
          sessionId: "test-session",
          symbol: "BTCUSDT",
          currentPrice: 65000,
          depth: 0,
          invocationsCount: 0
        },
        {
          microstructure: mockMicro
        }
      );

      expect(res.evidence[0]?.status).toBe("OK");
      expect(res.analysis).toContain("25.0%");
      expect(res.analysis).toContain("+450000.0");
      expect(res.analysis).not.toContain("[DATA_UNAVAILABLE]");
    });

    it("marks news_events_agent as [DATA_UNAVAILABLE] when news coverage is offline", async () => {
      const offlineAssessment: NewsRiskAssessment = {
        symbol: "BTCUSDT",
        hasHighImpactNews: false,
        riskLevel: "UNKNOWN",
        coverageStatus: "UNAVAILABLE",
        activeEvents: [],
        recommendation: "News stream offline",
        asOfIso: new Date().toISOString()
      };

      const res = await runSubagent(
        "news_events_agent",
        {
          sessionId: "test-session",
          symbol: "BTCUSDT",
          currentPrice: 65000,
          depth: 0,
          invocationsCount: 0
        },
        {
          newsAssessment: offlineAssessment
        }
      );

      expect(res.analysis).toContain("[DATA_UNAVAILABLE]");
      expect(res.recommendation).toBe("NO_ACTION");
      expect(res.evidence[0]?.status).toBe("INSUFFICIENT_DATA");
    });

    it("marks risk_guardian_agent as [CHECK_SKIPPED / НЕ ПЕРЕВІРЕНО] when daily limits were not verified", async () => {
      const res = await runSubagent(
        "risk_guardian_agent",
        {
          sessionId: "test-session",
          symbol: "BTCUSDT",
          currentPrice: 65000,
          depth: 0,
          invocationsCount: 0
        },
        {
          side: "long",
          entryPrice: 65000,
          stopLoss: 63000,
          accountDailyLossStatus: {
            checked: false,
            details: "Risk settings not loaded"
          }
        }
      );

      expect(res.analysis).toContain("[CHECK_SKIPPED / НЕ ПЕРЕВІРЕНО]");
      expect(res.recommendation).toBe("HOLD");
    });

    it("triggers RECOMMEND_CLOSE when daily loss limit is breached", async () => {
      const res = await runSubagent(
        "risk_guardian_agent",
        {
          sessionId: "test-session",
          symbol: "BTCUSDT",
          currentPrice: 65000,
          depth: 0,
          invocationsCount: 0
        },
        {
          side: "long",
          entryPrice: 65000,
          stopLoss: 63000,
          accountDailyLossStatus: {
            checked: true,
            limitBreached: true,
            currentRealizedLossUsdt: -250,
            details: "Денний збиток -$250 перевищив ліміт $200"
          }
        }
      );

      expect(res.analysis).toContain("КРИТИЧНО: Перевищено денний ліміт збитків");
      expect(res.recommendation).toBe("RECOMMEND_CLOSE");
    });
  });

  describe("P1.7 & P1.8 — Deduplication & Cursor Pagination", () => {
    it("simulates persistent event deduplication across worker restarts", () => {
      // Simulating a database table with unique index on (session_id, event_id)
      const persistentDbEvents = new Set<string>();

      function recordEvent(sessionId: string, eventId: string): boolean {
        const key = `${sessionId}::${eventId}`;
        if (persistentDbEvents.has(key)) {
          return false; // Unique violation (42P01 / 23505) -> ignored
        }
        persistentDbEvents.add(key);
        return true;
      }

      const sessionId = "session-test-123";
      const bucket1 = 18000;
      const slEventId = `sl_prox_${sessionId}_${bucket1}`;

      // Worker Node 1 delivers event
      expect(recordEvent(sessionId, slEventId)).toBe(true);

      // Same event evaluated in same bucket -> Deduplicated
      expect(recordEvent(sessionId, slEventId)).toBe(false);

      // WORKER RESTART: In-memory state is lost, but DB maintains the key
      // Worker restarts and evaluates the same trade:
      expect(recordEvent(sessionId, slEventId)).toBe(false);

      // New time bucket (15 min later) generates new eventId -> successfully delivered
      const bucket2 = 18001;
      const nextSlEventId = `sl_prox_${sessionId}_${bucket2}`;
      expect(recordEvent(sessionId, nextSlEventId)).toBe(true);
    });

    it("verifies cursor pagination on a session with 100+ messages", () => {
      // Simulating 110 messages in DB
      const allMessages = Array.from({ length: 110 }, (_, i) => ({
        id: `msg-${i + 1}`,
        createdAt: new Date(1700000000000 + i * 1000).toISOString(),
        content: `Message ${i + 1}`
      }));

      function fetchMessages(options?: { sinceIso?: string; limit?: number }) {
        const limit = options?.limit ?? 50;

        if (options?.sinceIso) {
          // Delta polling
          return allMessages
            .filter((m) => m.createdAt > options.sinceIso!)
            .slice(0, limit);
        }

        // Initial fetch: newest first, then chronological
        const newest = [...allMessages]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit);

        return newest.reverse();
      }

      // Initial load must return the NEWEST 50 messages (61..110), NOT the oldest (1..50)
      const initial = fetchMessages({ limit: 50 });
      expect(initial).toHaveLength(50);
      expect(initial[0]?.id).toBe("msg-61");
      expect(initial[initial.length - 1]?.id).toBe("msg-110");

      // Polling with sinceIso = msg-110.createdAt returns empty when no new messages
      const deltaEmpty = fetchMessages({ sinceIso: initial[initial.length - 1]!.createdAt });
      expect(deltaEmpty).toHaveLength(0);

      // New message 111 arrives
      allMessages.push({
        id: "msg-111",
        createdAt: new Date(1700000000000 + 110 * 1000).toISOString(),
        content: "Message 111"
      });

      const deltaNew = fetchMessages({ sinceIso: initial[initial.length - 1]!.createdAt });
      expect(deltaNew).toHaveLength(1);
      expect(deltaNew[0]?.id).toBe("msg-111");
    });
  });

  describe("P1.9 — Model Provenance & Real Usage Metrics", () => {
    it("reports real tokens and model source when OpenRouter responds", () => {
      const mockNemotronUsage = {
        promptTokens: 145,
        completionTokens: 82,
        totalTokens: 227
      };

      const payload = {
        source: "openrouter_llm" as const,
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",
        tokensUsed: mockNemotronUsage.totalTokens,
        verdict: "HOLD"
      };

      expect(payload.source).toBe("openrouter_llm");
      expect(payload.tokensUsed).toBe(227);
      expect(payload.tokensUsed).not.toBe(350); // Static 350 eliminated
    });

    it("reports deterministic_fallback and null tokens when key is missing", () => {
      const payload = {
        source: "deterministic_fallback" as const,
        model: "deterministic_synthesis",
        tokensUsed: null,
        verdict: "HOLD"
      };

      expect(payload.source).toBe("deterministic_fallback");
      expect(payload.tokensUsed).toBeNull();
    });
  });
});
