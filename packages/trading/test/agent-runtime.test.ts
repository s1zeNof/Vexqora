import { describe, it, expect } from "vitest";
import {
  executeAgentSkill,
  runSubagent,
  orchestrateTradeAnalysis,
  executeLeadTraderDynamicLoop,
  type AgentRunContext
} from "../src/agent-runtime";
import type { Kline } from "@crypto-bot/shared";

describe("Multi-Agent Runtime & Dynamic Tool Loop Engine (Phase P0-08, AT-02, AT-05, AT-06, AT-24)", () => {
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
    expect(synthesis.toolTraces?.length).toBeGreaterThan(0);
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

  it("AT-05: dynamically plans and executes indicator tools when user asks for ADX", async () => {
    const klinesLong = Array.from({ length: 40 }, (_, i) => ({
      time: 1000 + i * 60000,
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 101 + i,
      volume: 1000
    }));

    const result = await executeLeadTraderDynamicLoop({
      objective: "user_question",
      userQuery: "Порахуй ADX на 4H, потім перевір чи є дивергенція",
      symbol: "SOLUSDT",
      klines: klinesLong
    });

    expect(result.plan).toContain("list_indicators");
    expect(result.plan).toContain("compute_indicator:ADX");
    expect(result.toolTraces.some(t => t.toolName === "list_indicators")).toBe(true);
    expect(result.toolTraces.some(t => t.toolName === "compute_indicator")).toBe(true);
  });

  it("AT-06: selects orderflow and VWAP when asked about whale sell absorption instead of generic waterfall", async () => {
    const trades = [
      { price: 150, qty: 100, side: "sell" as const, time: 1000 },
      { price: 149.8, qty: 250, side: "sell" as const, time: 1500 }
    ];

    const result = await executeLeadTraderDynamicLoop({
      objective: "whale_check",
      userQuery: "чи є whale sell absorption на стрічці?",
      symbol: "SOLUSDT",
      trades,
      klines: dummyKlines
    });

    expect(result.plan).toEqual(["get_orderflow", "compute_indicator:VWAP", "get_market_structure"]);
    expect(result.toolTraces.some(t => t.toolName === "get_orderflow")).toBe(true);
    expect(result.toolTraces.some(t => t.toolName === "compute_indicator")).toBe(true);
  });

  it("AT-02 & AT-24: BTC contradiction triggers dynamic replanning and records full trace", async () => {
    // 60 candles of falling BTC (bearish trend)
    const btcFalling = Array.from({ length: 60 }, (_, i) => ({
      time: 1000 + i * 60000,
      open: 65000 - i * 100,
      high: 65100 - i * 100,
      low: 64900 - i * 100,
      close: 64950 - i * 100,
      volume: 1000
    }));

    const result = await executeLeadTraderDynamicLoop({
      objective: "trade_evaluation",
      symbol: "SOLUSDT",
      side: "long",
      currentPrice: 150,
      entryPrice: 148,
      stopLoss: 142,
      btcKlines: btcFalling,
      ethKlines: btcFalling,
      klines: dummyKlines
    });

    // Contradiction detected -> replanning cycle triggered get_btc_dependency
    expect(result.replanningCycles).toBeGreaterThan(1);
    expect(result.contradictionsFound.length).toBeGreaterThan(0);
    expect(result.contradictionsFound.some(c => c.includes("BEARISH"))).toBe(true);
    expect(result.toolTraces.some(t => t.toolName === "get_btc_dependency")).toBe(true);

    // Full trace exists
    expect(result.toolTraces.length).toBeGreaterThanOrEqual(4);
    for (const trace of result.toolTraces) {
      expect(trace.toolCallId).toBeDefined();
      expect(trace.startedAtMs).toBeGreaterThan(0);
      expect(trace.finishedAtMs).toBeGreaterThanOrEqual(trace.startedAtMs);
      expect(trace.status).toBeDefined();
    }

    // Stateful Trade Thesis generated with invalidation trigger
    expect(result.tradeThesis).toBeDefined();
    expect(result.tradeThesis?.status).toBe("WEAKENED");
    expect(result.tradeThesis?.invalidationTrigger).toBeDefined();
  });

  it("orchestrateTradeAnalysis passes BTC/ETH klines to dynamic loop and reflects dynamic loop verdict", async () => {
    // 60 candles of falling BTC (bearish trend)
    const btcFalling = Array.from({ length: 60 }, (_, i) => ({
      time: 1000 + i * 60000,
      open: 65000 - i * 100,
      high: 65100 - i * 100,
      low: 64900 - i * 100,
      close: 64950 - i * 100,
      volume: 1000
    }));

    const synthesis = await orchestrateTradeAnalysis({
      sessionId: "test_dynamic_integration",
      symbol: "SOLUSDT",
      currentPrice: 150,
      side: "long",
      entryPrice: 148,
      stopLoss: 142,
      tp1: 160,
      klines: dummyKlines,
      btcKlines: btcFalling,
      ethKlines: btcFalling
    });

    // The dynamic loop detected the BTC contradiction and weakened the trade verdict
    expect(["REVIEW", "RECOMMEND_REDUCE"]).toContain(synthesis.leadVerdict);
    expect(synthesis.summary).toContain("Lead Вердикт");
    expect(synthesis.toolTraces?.some(t => t.toolName === "get_btc_dependency")).toBe(true);
  });
});
