import { describe, it, expect } from "vitest";
import {
  executeAgentSkill,
  runSubagent,
  orchestrateTradeAnalysis,
  type AgentRunContext
} from "../src/agent-runtime";
import type { Kline } from "@crypto-bot/shared";

describe("Multi-Agent Runtime & Skill Engine (Phase P4)", () => {
  const dummyKlines: Kline[] = [
    { time: 1000, open: 100, high: 102, low: 99, close: 101, volume: 50 },
    { time: 2000, open: 101, high: 103, low: 100, close: 102, volume: 60 },
    { time: 3000, open: 102, high: 104, low: 101, close: 103, volume: 70 },
    { time: 4000, open: 103, high: 105, low: 102, close: 104, volume: 80 },
    { time: 5000, open: 104, high: 106, low: 103, close: 105, volume: 90 },
    { time: 6000, open: 105, high: 107, low: 104, close: 106, volume: 100 }
  ];

  it("executes market.mtf_structure skill correctly with sufficient klines", async () => {
    const context: AgentRunContext = {
      sessionId: "test_session",
      symbol: "SOLUSDT",
      currentPrice: 106,
      depth: 0,
      invocationsCount: 0
    };

    const res = await executeAgentSkill(
      "market.mtf_structure",
      { klines: dummyKlines },
      context
    );

    expect(res.status).toBe("OK");
    expect(res.data.regime).toBe("bullish_trend");
    expect(res.data.swingHigh).toBe(107);
    expect(res.data.swingLow).toBe(99);
    expect(res.evidenceIds.length).toBeGreaterThan(0);
  });

  it("returns INSUFFICIENT_DATA when klines are missing or short", async () => {
    const context: AgentRunContext = {
      sessionId: "test_session",
      symbol: "SOLUSDT",
      currentPrice: 106,
      depth: 0,
      invocationsCount: 0
    };

    const res = await executeAgentSkill(
      "market.mtf_structure",
      { klines: [] },
      context
    );

    expect(res.status).toBe("INSUFFICIENT_DATA");
  });

  it("enforces invocation budget limit", async () => {
    const context: AgentRunContext = {
      sessionId: "test_session",
      symbol: "SOLUSDT",
      currentPrice: 106,
      depth: 0,
      invocationsCount: 6,
      maxInvocations: 6
    };

    const res = await executeAgentSkill(
      "market.mtf_structure",
      { klines: dummyKlines },
      context
    );

    expect(res.status).toBe("ERROR");
    expect(res.error).toContain("budget exceeded");
  });

  it("enforces recursion depth limits on subagents", async () => {
    const context: AgentRunContext = {
      sessionId: "test_session",
      symbol: "SOLUSDT",
      currentPrice: 106,
      depth: 2,
      maxDepth: 2,
      invocationsCount: 0
    };

    const res = await runSubagent("market_structure_agent", context, { klines: dummyKlines });
    expect(res.status).toBe("skipped");
    expect(res.error).toBe("Recursion depth limit reached");
  });

  it("orchestrates trade analysis and returns synthesized Lead verdict without direct execution", async () => {
    const synthesis = await orchestrateTradeAnalysis({
      sessionId: "test_lead",
      symbol: "SOLUSDT",
      currentPrice: 105,
      side: "long",
      entryPrice: 100,
      stopLoss: 95,
      tp1: 110,
      klines: dummyKlines
    });

    expect(synthesis.leadVerdict).toBeDefined();
    expect(synthesis.subagentResults.length).toBe(4);
    expect(synthesis.authorizationRequirement).toBe("explicit_user_confirmation_required");
    expect(synthesis.isCalibrated).toBe(false);
    expect(synthesis.calibrationNotice).toContain("каліброваною");
  });

  it("recommends CLOSE when Stop Loss is breached in risk guardian", async () => {
    const synthesis = await orchestrateTradeAnalysis({
      sessionId: "test_sl_breach",
      symbol: "SOLUSDT",
      currentPrice: 94, // below SL 95 on long!
      side: "long",
      entryPrice: 100,
      stopLoss: 95,
      tp1: 110,
      klines: dummyKlines
    });

    expect(synthesis.leadVerdict).toBe("RECOMMEND_CLOSE");
    expect(synthesis.confidencePct).toBeGreaterThan(50);
    expect(synthesis.isCalibrated).toBe(false);
  });
});
