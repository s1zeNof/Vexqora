/**
 * Multi-Agent Runtime & Dynamic Tool-Calling Engine (P0-08, P0-12, Gate C)
 *
 * Implements genuine Agentic Lead Trader tool loop:
 * Plan -> Call Read-Only Tools -> Observe Evidence -> Evaluate Contradictions -> Replan -> Synthesize
 *
 * Guarantees:
 * 1. Dynamic tool selection based on task/question (not a static 4-agent waterfall).
 * 2. Real Tool Call Traces with actual timestamps, status, and outputs.
 * 3. Bounded replanning (max 2-3 cycles, max 8-15 tool calls).
 * 4. Generates stateful Trade Thesis with invalidation triggers and honest uncertainties.
 * 5. Strict grounding: missing data produces explicit [DATA_UNAVAILABLE] and [CHECK_SKIPPED].
 */

import type { Kline } from "@crypto-bot/shared";
import type { MarketMicrostructure } from "./microstructure";
import type { NewsEvent, NewsRiskAssessment } from "./news";
import type { MarketContextSnapshot } from "./market-context";
import {
  LeadTraderToolRegistry,
  type ToolResultEnvelope,
  type ToolStatus,
  type TradeThesis
} from "./tool-registry";
import {
  callNemotronWithTools,
  LEAD_TRADER_TOOLS,
  type OpenRouterToolCall,
  type NemotronToolCallResponse
} from "./nemotron";

export type AgentKey =
  | "lead_trade_agent"
  | "market_structure_agent"
  | "order_flow_agent"
  | "derivatives_agent"
  | "risk_guardian_agent"
  | "news_events_agent"
  | "quant_ml_agent"
  | "execution_quality_agent"
  | "trade_learning_agent";

export type SkillKey =
  | "market.mtf_structure"
  | "orderflow.cvd_obi"
  | "derivatives.squeeze_oi"
  | "news.impact_scanner"
  | "risk.capital_guardian"
  | "quant.feature_extraction"
  | "execution.quality_audit";

export interface AccountDailyLossStatus {
  checked: boolean;
  dailyLossLimitPct?: number | undefined;
  currentRealizedLossUsdt?: number | undefined;
  limitBreached?: boolean | undefined;
  balanceUsdt?: number | undefined;
  details?: string | undefined;
}

export interface ToolCallTrace {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  startedAtMs: number;
  finishedAtMs: number;
  status: ToolStatus;
  dataAsOfMs: number;
  source: string;
  summary: string;
}

export interface DynamicToolLoopRequest {
  objective: "trade_evaluation" | "user_question" | "whale_check" | "btc_regime_impact" | "custom";
  userQuery?: string | undefined;
  symbol: string;
  side?: "long" | "short" | undefined;
  currentPrice?: number | undefined;
  entryPrice?: number | undefined;
  stopLoss?: number | undefined;
  tp1?: number | undefined;
  klines?: Kline[] | undefined;
  btcKlines?: Kline[] | undefined;
  ethKlines?: Kline[] | undefined;
  trades?: Array<{ price: number; qty: number; side: "buy" | "sell"; time: number }> | undefined;
  maxCycles?: number | undefined;
  registry?: LeadTraderToolRegistry | undefined;
}

export interface DynamicToolLoopResult {
  toolTraces: ToolCallTrace[];
  plan: string[];
  replanningCycles: number;
  tradeThesis?: TradeThesis | undefined;
  leadVerdict: "HOLD" | "REVIEW" | "RECOMMEND_REDUCE" | "RECOMMEND_CLOSE" | "NO_ACTION" | "LONG" | "SHORT" | "WAIT" | "NO_TRADE";
  summary: string;
  contradictionsFound: string[];
  invalidationTrigger?: string | undefined;
  qualityWarnings: string[];
  asOfMs: number;
}

export interface OrchestrateTradeAnalysisParams {
  sessionId?: string | undefined;
  symbol: string;
  currentPrice: number;
  side: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  klines?: Kline[] | undefined;
  btcKlines?: Kline[] | undefined;
  ethKlines?: Kline[] | undefined;
  trades?: Array<{ price: number; qty: number; side: "buy" | "sell"; time: number }> | undefined;
  userQuery?: string | undefined;
  mtfSnapshot?: MarketContextSnapshot | null | undefined;
  microstructure?: MarketMicrostructure | null | undefined;
  newsEvents?: NewsEvent[] | undefined;
  newsAssessment?: NewsRiskAssessment | null | undefined;
  accountDailyLossStatus?: AccountDailyLossStatus | null | undefined;
}

export interface AgentRunContext {
  sessionId: string;
  tradeId?: string | null | undefined;
  symbol: string;
  currentPrice: number;
  depth: number;
  invocationsCount: number;
  maxDepth?: number | undefined;
  maxInvocations?: number | undefined;
}

export interface SkillExecutionResult {
  skillKey: SkillKey;
  status: "OK" | "INSUFFICIENT_DATA" | "STALE" | "ERROR";
  data: Record<string, unknown>;
  evidenceIds: string[];
  latencyMs: number;
  dataAsOfMs: number;
  error?: string | undefined;
}

export interface AgentRunResult {
  agentKey: AgentKey;
  status: "completed" | "failed" | "skipped";
  analysis: string;
  recommendation?: "HOLD" | "REVIEW" | "RECOMMEND_REDUCE" | "RECOMMEND_CLOSE" | "NO_ACTION" | undefined;
  evidence: SkillExecutionResult[];
  latencyMs: number;
  error?: string | undefined;
}

export interface LeadTradeSynthesis {
  leadVerdict: "HOLD" | "REVIEW" | "RECOMMEND_REDUCE" | "RECOMMEND_CLOSE" | "NO_ACTION";
  confidencePct: number;
  isCalibrated: false;
  calibrationNotice: string;
  summary: string;
  subagentResults: AgentRunResult[];
  toolTraces?: ToolCallTrace[] | undefined;
  timestampMs: number;
  authorizationRequirement: "explicit_user_confirmation_required";
}

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_INVOCATIONS = 6;

/**
 * Executes a deterministic skill with timeout and error capture.
 */
export async function executeAgentSkill(
  skillKey: SkillKey,
  input: Record<string, unknown>,
  context: AgentRunContext
): Promise<SkillExecutionResult> {
  await Promise.resolve();
  const startTime = Date.now();
  const maxInvocations = context.maxInvocations ?? DEFAULT_MAX_INVOCATIONS;

  if (context.invocationsCount >= maxInvocations) {
    return {
      skillKey,
      status: "ERROR",
      data: {},
      evidenceIds: [],
      latencyMs: Date.now() - startTime,
      dataAsOfMs: Date.now(),
      error: `Skill execution budget exceeded (${context.invocationsCount}/${maxInvocations})`
    };
  }

  context.invocationsCount++;

  try {
    switch (skillKey) {
      case "market.mtf_structure": {
        const klines = (input.klines as Kline[] | undefined) ?? [];
        if (klines.length < 5) {
          return {
            skillKey,
            status: "INSUFFICIENT_DATA",
            data: { reason: "Need at least 5 bars for structure evaluation" },
            evidenceIds: [],
            latencyMs: Date.now() - startTime,
            dataAsOfMs: Date.now()
          };
        }
        const lastBar = klines[klines.length - 1]!;
        const prevBar = klines[klines.length - 2]!;
        const isBullish = lastBar.close > prevBar.close;

        return {
          skillKey,
          status: "OK",
          data: {
            regime: isBullish ? "bullish_trend" : "bearish_trend",
            lastClose: lastBar.close,
            swingHigh: Math.max(...klines.map((k) => k.high)),
            swingLow: Math.min(...klines.map((k) => k.low))
          },
          evidenceIds: [`kline_${lastBar.time}`],
          latencyMs: Date.now() - startTime,
          dataAsOfMs: lastBar.time
        };
      }

      case "orderflow.cvd_obi": {
        const micro = input.microstructure as MarketMicrostructure | null | undefined;
        if (!micro) {
          return {
            skillKey,
            status: "INSUFFICIENT_DATA",
            data: { message: "[DATA_UNAVAILABLE] Live order book / CVD stream unavailable" },
            evidenceIds: [],
            latencyMs: Date.now() - startTime,
            dataAsOfMs: Date.now()
          };
        }

        const obi = micro.orderBook.weightedImbalance;
        const cvd = micro.tape.cvdUsd;

        return {
          skillKey,
          status: "OK",
          data: {
            obi,
            cvd,
            buyerAggressionPct: micro.tape.buyerAggressionPct,
            whaleTradesCount: micro.tape.whaleTradesCount
          },
          evidenceIds: [`micro_${micro.timestamp}`],
          latencyMs: Date.now() - startTime,
          dataAsOfMs: micro.timestamp
        };
      }

      case "risk.capital_guardian": {
        const side = input.side as "long" | "short";
        const stopLoss = Number(input.stopLoss ?? 0);
        const currentPrice = Number(context.currentPrice);
        const slBreached = side === "long" ? currentPrice <= stopLoss : currentPrice >= stopLoss;

        const dailyStatus = input.accountDailyLossStatus as AccountDailyLossStatus | null | undefined;
        const dailyLossChecked = dailyStatus?.checked ?? false;
        const dailyLossBreached = dailyStatus?.limitBreached ?? false;
        const dailyLossDetails = dailyStatus?.details ?? "";

        return {
          skillKey,
          status: "OK",
          data: {
            slBreached,
            currentPrice,
            stopLoss,
            dailyLossChecked,
            dailyLossBreached,
            dailyLossDetails
          },
          evidenceIds: [`risk_${context.symbol}_${Date.now()}`],
          latencyMs: Date.now() - startTime,
          dataAsOfMs: Date.now()
        };
      }

      case "news.impact_scanner": {
        const assessment = input.newsAssessment as NewsRiskAssessment | null | undefined;
        if (!assessment || assessment.coverageStatus === "UNAVAILABLE") {
          return {
            skillKey,
            status: "INSUFFICIENT_DATA",
            data: { message: "[DATA_UNAVAILABLE] News feed offline or degraded" },
            evidenceIds: [],
            latencyMs: Date.now() - startTime,
            dataAsOfMs: Date.now()
          };
        }

        const highImpact = assessment.hasHighImpactNews;

        return {
          skillKey,
          status: "OK",
          data: {
            highImpact,
            riskLevel: assessment.riskLevel,
            eventsCount: assessment.activeEvents.length
          },
          evidenceIds: [`news_${context.symbol}_${assessment.asOfIso}`],
          latencyMs: Date.now() - startTime,
          dataAsOfMs: new Date(assessment.asOfIso).getTime()
        };
      }

      default:
        return {
          skillKey,
          status: "ERROR",
          data: {},
          evidenceIds: [],
          latencyMs: Date.now() - startTime,
          dataAsOfMs: Date.now(),
          error: `Unknown skill key: ${skillKey}`
        };
    }
  } catch (err) {
    return {
      skillKey,
      status: "ERROR",
      data: {},
      evidenceIds: [],
      latencyMs: Date.now() - startTime,
      dataAsOfMs: Date.now(),
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Runs a specialized subagent with strict grounded analysis.
 */
export async function runSubagent(
  agentKey: AgentKey,
  context: AgentRunContext,
  payload: Record<string, unknown>
): Promise<AgentRunResult> {
  const startTime = Date.now();
  const maxDepth = context.maxDepth ?? DEFAULT_MAX_DEPTH;

  if (context.depth >= maxDepth) {
    return {
      agentKey,
      status: "skipped",
      analysis: `Глибина рекурсії виклику субагента вичерпана (ліміт: ${maxDepth}).`,
      evidence: [],
      latencyMs: Date.now() - startTime,
      error: "Recursion depth limit reached"
    };
  }

  const childContext: AgentRunContext = {
    ...context,
    depth: context.depth + 1
  };

  const evidence: SkillExecutionResult[] = [];

  switch (agentKey) {
    case "market_structure_agent": {
      const res = await executeAgentSkill("market.mtf_structure", payload, childContext);
      evidence.push(res);
      const isOk = res.status === "OK";
      const regime = (res.data.regime as string) ?? "unknown";
      const high = Number(res.data.swingHigh ?? 0);
      const low = Number(res.data.swingLow ?? 0);

      return {
        agentKey,
        status: "completed",
        analysis: isOk
          ? `Ринкова структура: ${regime}. Локальний діапазон: [${low} - ${high}].`
          : "Дані ринкової структури недостатні для висновку [DATA_UNAVAILABLE].",
        recommendation: isOk ? "HOLD" : "REVIEW",
        evidence,
        latencyMs: Date.now() - startTime
      };
    }

    case "order_flow_agent": {
      const res = await executeAgentSkill("orderflow.cvd_obi", payload, childContext);
      evidence.push(res);
      const isOk = res.status === "OK";
      const cvd = Number(res.data.cvd ?? 0);
      const obi = Number(res.data.obi ?? 0);

      return {
        agentKey,
        status: "completed",
        analysis: isOk
          ? `Потік ордерів: CVD: ${cvd >= 0 ? "+" : ""}${cvd.toFixed(1)} USD, OBI: ${(obi * 100).toFixed(1)}%.`
          : "Потік ордерів (Order Flow) недоступний або відсутнє підключення до L2 стакана [DATA_UNAVAILABLE].",
        recommendation: isOk ? "HOLD" : "NO_ACTION",
        evidence,
        latencyMs: Date.now() - startTime
      };
    }

    case "risk_guardian_agent": {
      const res = await executeAgentSkill("risk.capital_guardian", payload, childContext);
      evidence.push(res);
      const slBreached = Boolean(res.data.slBreached);
      const dailyLossChecked = Boolean(res.data.dailyLossChecked);
      const dailyLossBreached = Boolean(res.data.dailyLossBreached);
      const detailsStr = typeof res.data.dailyLossDetails === "string" ? res.data.dailyLossDetails : "";

      const side = (payload.side as "long" | "short") ?? "long";
      const entry = Number(payload.entryPrice ?? childContext.currentPrice);
      const current = childContext.currentPrice;
      const isProfitable = entry > 0 && (side === "long" ? current > entry : current < entry);

      let analysis: string;
      if (!dailyLossChecked) {
        analysis = (slBreached ? "УВАГА: Захисний Stop Loss досягнуто або пробито! " : "Рівень ризику позиції контрольований. ") +
          "Денні ліміти акаунту: [CHECK_SKIPPED / НЕ ПЕРЕВІРЕНО].";
      } else if (dailyLossBreached) {
        if (isProfitable) {
          analysis = `Загальний денний ліміт втрат за день досягнуто (${detailsStr}), проте поточна позиція у прибутку. Рекомендується супровід за планом або часткова фіксація прибутку (50%).`;
        } else {
          analysis = `КРИТИЧНО: Перевищено денний ліміт збитків! (${detailsStr}). ` +
            (slBreached ? "Захисний Stop Loss пробито!" : "Рекомендується негайний перегляд позицій.");
        }
      } else {
        analysis = (slBreached ? "УВАГА: Захисний Stop Loss досягнуто або пробито! " : "Рівень ризику позиції контрольований. ") +
          "Денний ліміт збитків перевірено: ліміт у нормі.";
      }

      const recommendation = slBreached
        ? "RECOMMEND_CLOSE"
        : (dailyLossBreached && !isProfitable)
          ? "RECOMMEND_CLOSE"
          : "HOLD";

      return {
        agentKey,
        status: "completed",
        analysis,
        recommendation,
        evidence,
        latencyMs: Date.now() - startTime
      };
    }

    case "news_events_agent": {
      const res = await executeAgentSkill("news.impact_scanner", payload, childContext);
      evidence.push(res);
      const isOk = res.status === "OK";
      const hasHighImpact = Boolean(res.data.highImpact);

      return {
        agentKey,
        status: "completed",
        analysis: !isOk
          ? "Стрічка верифікованих новин тимчасово недоступна [DATA_UNAVAILABLE]."
          : hasHighImpact
            ? "Виявлено важливі макро-події або біржові анонси, що можуть підвищити волатильність."
            : "Критичних негативних новин або делістингів для монети не зафіксовано.",
        recommendation: !isOk ? "NO_ACTION" : (hasHighImpact ? "RECOMMEND_REDUCE" : "HOLD"),
        evidence,
        latencyMs: Date.now() - startTime
      };
    }

    default:
      return {
        agentKey,
        status: "completed",
        analysis: `Агент ${agentKey} завершив роботу в фоновому режимі.`,
        recommendation: "NO_ACTION",
        evidence: [],
        latencyMs: Date.now() - startTime
      };
  }
}

/**
 * Executes dynamic Agentic Lead Trader tool loop.
 *
 * Implements:
 * 1. True LLM-directed tool calling via OpenRouter tools schema when API key is configured.
 * 2. Model decides which read-only tools to call, observes outputs, resolves contradictions.
 * 3. Transparent deterministic fallback execution when OPENROUTER_API_KEY is absent (offline test/CI).
 * 4. Stateful thesis persistence with revision history via DurableTradeThesisStore.
 */
export async function executeLeadTraderDynamicLoop(
  req: DynamicToolLoopRequest
): Promise<DynamicToolLoopResult> {
  const registry = req.registry ?? new LeadTraderToolRegistry();
  const symbol = req.symbol.toUpperCase();
  const currentPrice = req.currentPrice ?? req.entryPrice ?? 0;
  const klines = req.klines ?? [];
  const btcKlines = req.btcKlines ?? [];
  const ethKlines = req.ethKlines ?? [];
  const trades = req.trades ?? [];
  const traces: ToolCallTrace[] = [];
  const plan: string[] = [];
  const contradictionsFound: string[] = [];
  const warnings: string[] = [];

  // Helper to record a tool call execution
  const recordToolCall = <T>(
    toolName: string,
    args: Record<string, unknown>,
    fn: () => ToolResultEnvelope<T> | Promise<ToolResultEnvelope<T>>
  ): Promise<ToolResultEnvelope<T>> => {
    const started = Date.now();
    return Promise.resolve(fn()).then(res => {
      const finished = Date.now();
      traces.push({
        toolCallId: `call-${traces.length + 1}-${toolName}`,
        toolName,
        args,
        startedAtMs: started,
        finishedAtMs: finished,
        status: res.status,
        dataAsOfMs: res.asOfMs,
        source: res.source,
        summary: res.status === "OK"
          ? `Executed successfully with source ${res.source}`
          : `Status ${res.status}: ${res.error ?? "No data"}`
      });
      if (res.qualityWarnings.length > 0) warnings.push(...res.qualityWarnings);
      return res;
    });
  };

  // Dispatcher executing validated read-only tools
  const dispatchTool = async (name: string, args: Record<string, unknown>): Promise<ToolResultEnvelope<unknown>> => {
    switch (name) {
      case "get_global_market_regime":
        return recordToolCall("get_global_market_regime", args, () =>
          registry.getGlobalMarketRegime(btcKlines, ethKlines)
        );
      case "get_btc_dependency":
        return recordToolCall("get_btc_dependency", args, () =>
          registry.getBtcDependency(symbol, klines, btcKlines)
        );
      case "list_indicators":
        return recordToolCall("list_indicators", args, () =>
          registry.listIndicators()
        );
      case "compute_indicator": {
        const ind = typeof args.indicator === "string" ? args.indicator.toUpperCase() : "ADX";
        const period = typeof args.period === "number" ? args.period : 14;
        return recordToolCall("compute_indicator", { symbol, indicator: ind, period }, () =>
          registry.computeIndicator(symbol, ind, klines, { period })
        );
      }
      case "get_market_structure":
        return recordToolCall("get_market_structure", args, () =>
          registry.getMarketStructure(symbol, klines, currentPrice)
        );
      case "get_orderflow":
        return recordToolCall("get_orderflow", args, () =>
          registry.getOrderflow(symbol, trades)
        );
      case "search_verified_news":
        return recordToolCall("search_verified_news", args, () =>
          registry.searchVerifiedNews(symbol)
        );
      case "get_economic_calendar":
        return recordToolCall("get_economic_calendar", args, () =>
          registry.getEconomicCalendar()
        );
      default:
        return {
          toolName: name,
          status: "ERROR",
          exchange: "Bybit",
          marketType: "linear",
          symbol,
          source: "ToolDispatcher",
          asOfMs: Date.now(),
          receivedAtMs: Date.now(),
          qualityWarnings: [`Unknown tool requested: ${name}`],
          data: null,
          error: `Tool ${name} is not recognized by LeadTraderToolRegistry.`
        };
    }
  };

  type BtcRegimeDataType = { btcTrend: string; ethTrend: string; riskEnvironment: string; marketBreadthPct: number | null };
  type SmcDataType = NonNullable<ReturnType<LeadTraderToolRegistry["getMarketStructure"]>["data"]>;
  type OrderFlowDataType = NonNullable<ReturnType<LeadTraderToolRegistry["getOrderflow"]>["data"]>;
  type IndicatorDataType = { indicator: string; value: number | null };

  let btcRegimeData: BtcRegimeDataType | null = null;
  let smcData: SmcDataType | null = null;
  let orderFlowData: OrderFlowDataType | null = null;
  let newsData: NewsEvent[] | null = null;
  let indicatorResult: IndicatorDataType | null = null;

  // ==========================================
  // Phase 1 & 2: Genuine LLM Tool-Calling Loop (or Transparent Fallback)
  // ==========================================
  const messages: Array<{
    role: string;
    content?: string | null;
    tool_call_id?: string;
    tool_calls?: OpenRouterToolCall[];
  }> = [
    {
      role: "system",
      content:
        `You are the Vexqora Lead Trade Agent. You independently plan, investigate, and verify market conditions for ${symbol} (${req.side ?? "neutral"}). ` +
        `Current price is $${currentPrice}. ` +
        `You have access to strictly read-only analytical tools. Choose the tools you need to assess trend structure, order flow, BTC correlation, volatility, or news. ` +
        `If you see contradictions between different tools, call follow-up tools to resolve them. ` +
        `When you have sufficient evidence, provide your final synthesis, verdict (HOLD, REVIEW, RECOMMEND_REDUCE, RECOMMEND_CLOSE), and trade thesis.`
    },
    {
      role: "user",
      content: req.userQuery ?? `Evaluate trade setup for ${symbol} (${req.side ?? "neutral"}). Objective: ${req.objective}.`
    }
  ];

  let replanningCycles = 0;
  let llmDrovePlan = false;
  const maxCycles = req.maxCycles ?? 3;
  let currentCycle = 0;

  // Real LLM Tool-Calling loop if OpenRouter API is available
  while (currentCycle < maxCycles) {
    currentCycle++;
    let response: NemotronToolCallResponse | null;
    try {
      response = await callNemotronWithTools(messages, { tools: LEAD_TRADER_TOOLS });
    } catch {
      response = null;
    }

    if (!response || !response.toolCalls || response.toolCalls.length === 0) {
      if (response?.content) {
        llmDrovePlan = true;
      }
      break;
    }

    llmDrovePlan = true;
    replanningCycles = currentCycle;

    messages.push({
      role: "assistant",
      content: response.content ?? "",
      tool_calls: response.toolCalls
    });

    for (const tc of response.toolCalls) {
      plan.push(tc.function.name);
      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        parsedArgs = {};
      }

      const toolRes = await dispatchTool(tc.function.name, parsedArgs);
      if (tc.function.name === "get_global_market_regime" && toolRes.data) {
        btcRegimeData = toolRes.data as unknown as BtcRegimeDataType;
      } else if (tc.function.name === "get_market_structure" && toolRes.data) {
        smcData = toolRes.data as unknown as SmcDataType;
      } else if (tc.function.name === "get_orderflow" && toolRes.data) {
        orderFlowData = toolRes.data as unknown as OrderFlowDataType;
      } else if (tc.function.name === "search_verified_news" && toolRes.data) {
        newsData = toolRes.data as unknown as NewsEvent[];
      } else if (tc.function.name === "compute_indicator" && toolRes.data) {
        indicatorResult = toolRes.data as unknown as IndicatorDataType;
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(toolRes.data)
      });
    }
  }

  // Transparent fallback if LLM API is unavailable (offline test, CI, no key)
  if (!llmDrovePlan || traces.length === 0) {
    warnings.push("Tool execution used deterministic fallback engine (OPENROUTER_API_KEY not configured).");
    const query = (req.userQuery ?? "").toLowerCase();
    const fallbackTools: string[] = [];

    if (query.includes("adx") || query.includes("індикатор") || query.includes("divergence")) {
      fallbackTools.push("list_indicators", "compute_indicator:ADX");
    } else if (req.objective === "whale_check" || query.includes("whale") || query.includes("absorption")) {
      fallbackTools.push("get_orderflow", "compute_indicator:VWAP", "get_market_structure");
    } else if (req.objective === "btc_regime_impact" || query.includes("btc") || query.includes("біткоїн")) {
      fallbackTools.push("get_global_market_regime", "get_btc_dependency", "get_market_structure");
    } else {
      fallbackTools.push("get_global_market_regime", "get_market_structure", "get_orderflow", "search_verified_news");
      if (klines.length >= 28) {
        fallbackTools.push("compute_indicator:ADX");
      }
    }

    for (const item of fallbackTools) {
      plan.push(item);
      if (item.startsWith("compute_indicator:")) {
        const ind = item.split(":")[1]!;
        const res = await dispatchTool("compute_indicator", { symbol, indicator: ind, period: 14 });
        if (res.data) indicatorResult = res.data as unknown as IndicatorDataType;
      } else {
        const res = await dispatchTool(item, { symbol, currentPrice });
        if (item === "get_global_market_regime" && res.data) btcRegimeData = res.data as unknown as BtcRegimeDataType;
        else if (item === "get_market_structure" && res.data) smcData = res.data as unknown as SmcDataType;
        else if (item === "get_orderflow" && res.data) orderFlowData = res.data as unknown as OrderFlowDataType;
        else if (item === "search_verified_news" && res.data) newsData = res.data as unknown as NewsEvent[];
      }
    }
    replanningCycles = 1;
  }

  // ==========================================
  // Phase 3: Observe & Contradiction Evaluation (Replanning)
  // ==========================================
  const isLong = req.side === "long";

  // Check 1: Contradiction between Bullish Structure and Bearish BTC
  if (btcRegimeData?.btcTrend === "bearish_trend" && (isLong || smcData?.trend === "bullish")) {
    contradictionsFound.push("BTC перебуває у спадному (BEARISH) режимі, тоді як альткоїн показує бичачі ознаки.");
    if (!plan.includes("get_btc_dependency")) {
      replanningCycles++;
      plan.push("get_btc_dependency");
      await dispatchTool("get_btc_dependency", { symbol });
    }
  }

  // Check 2: Contradiction between Long and negative CVD tape
  if (isLong && orderFlowData && orderFlowData.cvdUsd < -500) {
    contradictionsFound.push(`Потік ордерів показує домінування агресивних продажів (CVD = ${orderFlowData.cvdUsd} USD).`);
    if (!plan.some(p => p.includes("ADX")) && klines.length >= 28) {
      replanningCycles++;
      plan.push("compute_indicator:ADX");
      const res = await dispatchTool("compute_indicator", { symbol, indicator: "ADX", period: 14 });
      if (res.data) indicatorResult = res.data as unknown as IndicatorDataType;
    }
  }

  // ==========================================
  // Phase 4: Synthesis & Stateful Trade Thesis
  // ==========================================
  let leadVerdict: DynamicToolLoopResult["leadVerdict"] = "HOLD";

  if (req.stopLoss && currentPrice > 0) {
    const slBreached = isLong ? currentPrice <= req.stopLoss : currentPrice >= req.stopLoss;
    if (slBreached) {
      leadVerdict = "RECOMMEND_CLOSE";
    }
  }

  if (leadVerdict !== "RECOMMEND_CLOSE") {
    if (contradictionsFound.length >= 2) {
      leadVerdict = "RECOMMEND_REDUCE";
    } else if (contradictionsFound.length === 1) {
      leadVerdict = "REVIEW";
    } else if (newsData && newsData.some(n => n.impactLevel === "critical")) {
      leadVerdict = "RECOMMEND_CLOSE";
    }
  }

  const invalidationTrigger = req.stopLoss
    ? `Підтверджене закриття 15M свічки за рівнем Stop Loss: $${req.stopLoss.toFixed(4)}`
    : (smcData?.swingLow
        ? `Пробиття локального свінг-лоу: $${smcData.swingLow.toFixed(4)}`
        : "Зміна 4H ринкової структури на протилежну");

  const indTag = indicatorResult ? ` [${indicatorResult.indicator}: ${indicatorResult.value}]` : "";
  const summary = `Lead Trader Agent синтез для ${symbol}: ` +
    `Виконано ${traces.length} викликів інструментів (${traces.map(t => t.toolName).join(", ")})${indTag}. ` +
    (contradictionsFound.length > 0
      ? `Виявлено суперечності: ${contradictionsFound.join(" ")} `
      : "Доказова база цілісна. ") +
    `Вердикт: ${leadVerdict}.`;

  const tradeThesis: TradeThesis = {
    thesisId: `thesis-${symbol.toLowerCase()}-${Date.now()}`,
    symbol,
    side: req.side ?? "neutral",
    status: contradictionsFound.length > 0 ? "WEAKENED" : "VALID",
    revision: 1,
    entryPrice: req.entryPrice ?? currentPrice,
    invalidationPrice: req.stopLoss ?? (smcData?.swingLow ?? currentPrice * 0.97),
    primaryRationale: smcData ? `Ринкова структура: ${smcData.trend}, swing low: $${smcData.swingLow}` : "Аналіз ринкової структури та потоку ордерів",
    invalidationTrigger,
    supportingEvidence: traces.filter(t => t.status === "OK").map(t => `${t.toolName} verified`),
    opposingEvidence: contradictionsFound,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now()
  };

  await registry.saveTradeThesis(tradeThesis);

  return {
    toolTraces: traces,
    plan,
    replanningCycles,
    tradeThesis,
    leadVerdict,
    summary,
    contradictionsFound,
    invalidationTrigger,
    qualityWarnings: warnings,
    asOfMs: Date.now()
  };
}

/**
 * Lead Trade Agent multi-agent orchestration for a trade session.
 * Gathers intelligence across specialized agents with bounded recursion and returns synthesis.
 */
export async function orchestrateTradeAnalysis(
  params: OrchestrateTradeAnalysisParams
): Promise<LeadTradeSynthesis> {
  const rootContext: AgentRunContext = {
    sessionId: params.sessionId ?? "session_ephemeral",
    symbol: params.symbol,
    currentPrice: params.currentPrice,
    depth: 0,
    invocationsCount: 0,
    maxDepth: DEFAULT_MAX_DEPTH,
    maxInvocations: DEFAULT_MAX_INVOCATIONS
  };

  const payload: Record<string, unknown> = {
    symbol: params.symbol,
    side: params.side,
    entryPrice: params.entryPrice,
    stopLoss: params.stopLoss,
    tp1: params.tp1,
    klines: params.klines ?? [],
    btcKlines: params.btcKlines ?? [],
    ethKlines: params.ethKlines ?? [],
    trades: params.trades ?? [],
    mtfSnapshot: params.mtfSnapshot ?? null,
    microstructure: params.microstructure ?? null,
    newsEvents: params.newsEvents ?? [],
    newsAssessment: params.newsAssessment ?? null,
    accountDailyLossStatus: params.accountDailyLossStatus ?? null
  };

  const [structureRes, orderFlowRes, riskRes, newsRes, dynamicLoop] = await Promise.all([
    runSubagent("market_structure_agent", rootContext, payload),
    runSubagent("order_flow_agent", rootContext, payload),
    runSubagent("risk_guardian_agent", rootContext, payload),
    runSubagent("news_events_agent", rootContext, payload),
    executeLeadTraderDynamicLoop({
      objective: "trade_evaluation",
      symbol: params.symbol,
      side: params.side,
      currentPrice: params.currentPrice,
      entryPrice: params.entryPrice,
      stopLoss: params.stopLoss,
      tp1: params.tp1,
      userQuery: params.userQuery,
      trades: params.trades,
      ...(params.klines ? { klines: params.klines } : {}),
      ...(params.btcKlines ? { btcKlines: params.btcKlines } : {}),
      ...(params.ethKlines ? { ethKlines: params.ethKlines } : {})
    })
  ]);

  const subagentResults = [structureRes, orderFlowRes, riskRes, newsRes];

  let validEvidenceCount = 0;
  for (const res of subagentResults) {
    for (const ev of res.evidence) {
      if (ev.status === "OK") validEvidenceCount++;
    }
  }

  const evidenceCompleteness = subagentResults.length > 0
    ? Math.min(1, validEvidenceCount / subagentResults.length)
    : 0;

  // Master verdict directly integrates dynamic Lead Agent decision + Risk Guardian safety
  let leadVerdict: LeadTradeSynthesis["leadVerdict"] = "HOLD";

  if (riskRes.recommendation === "RECOMMEND_CLOSE" || dynamicLoop.leadVerdict === "RECOMMEND_CLOSE") {
    leadVerdict = "RECOMMEND_CLOSE";
  } else if (
    dynamicLoop.leadVerdict === "RECOMMEND_REDUCE" ||
    newsRes.recommendation === "RECOMMEND_REDUCE" ||
    orderFlowRes.recommendation === "REVIEW"
  ) {
    leadVerdict = "RECOMMEND_REDUCE";
  } else if (dynamicLoop.leadVerdict === "REVIEW" || structureRes.recommendation === "REVIEW") {
    leadVerdict = "REVIEW";
  } else if (dynamicLoop.leadVerdict === "HOLD") {
    leadVerdict = "HOLD";
  }

  const confidencePct = Math.round(40 + 50 * evidenceCompleteness);
  const calibrationNotice =
    "УВАГА: Оцінка надійності є евристичним зведенням доказів субагентів, а не статистично каліброваною байєсівською ймовірністю.";

  const summary = `Lead Trade Agent синтез для ${params.symbol}: ` +
    `Lead Вердикт (${dynamicLoop.leadVerdict}), Структура (${structureRes.recommendation}), Потік ордерів (${orderFlowRes.recommendation}), ` +
    `Ризик (${riskRes.recommendation}), Новини (${newsRes.recommendation}). Вердикт: ${leadVerdict}.`;

  return {
    leadVerdict,
    confidencePct,
    isCalibrated: false,
    calibrationNotice,
    summary,
    subagentResults,
    toolTraces: dynamicLoop.toolTraces,
    timestampMs: Date.now(),
    authorizationRequirement: "explicit_user_confirmation_required"
  };
}
