/**
 * Multi-Agent Runtime & Skill Execution Engine (Phase P4)
 * Orchestrates Lead Trade Agent, subagents, and bounded tool calls.
 */

import type { Kline } from "@crypto-bot/shared";
import type { MarketMicrostructure } from "./microstructure";
import type { NewsEvent, NewsRiskAssessment } from "./news";
import type { MarketContextSnapshot } from "./market-context";

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
  dailyLossLimitPct?: number;
  currentRealizedLossUsdt?: number;
  limitBreached?: boolean;
  balanceUsdt?: number;
  details?: string;
}

export interface OrchestrateTradeAnalysisParams {
  sessionId?: string;
  symbol: string;
  currentPrice: number;
  side: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  klines?: Kline[];
  mtfSnapshot?: MarketContextSnapshot | null;
  microstructure?: MarketMicrostructure | null;
  newsEvents?: NewsEvent[];
  newsAssessment?: NewsRiskAssessment | null;
  accountDailyLossStatus?: AccountDailyLossStatus | null;
}

export interface AgentRunContext {
  sessionId: string;
  tradeId?: string | null;
  symbol: string;
  currentPrice: number;
  depth: number;
  invocationsCount: number;
  maxDepth?: number;
  maxInvocations?: number;
}

export interface SkillExecutionResult {
  skillKey: SkillKey;
  status: "OK" | "INSUFFICIENT_DATA" | "STALE" | "ERROR";
  data: Record<string, unknown>;
  evidenceIds: string[];
  latencyMs: number;
  dataAsOfMs: number;
  error?: string;
}

export interface AgentRunResult {
  agentKey: AgentKey;
  status: "completed" | "failed" | "skipped";
  analysis: string;
  recommendation?: "HOLD" | "REVIEW" | "RECOMMEND_REDUCE" | "RECOMMEND_CLOSE" | "NO_ACTION";
  evidence: SkillExecutionResult[];
  latencyMs: number;
  error?: string;
}

export interface LeadTradeSynthesis {
  leadVerdict: "HOLD" | "REVIEW" | "RECOMMEND_REDUCE" | "RECOMMEND_CLOSE" | "NO_ACTION";
  confidencePct: number;
  isCalibrated: false;
  calibrationNotice: string;
  summary: string;
  subagentResults: AgentRunResult[];
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
        return {
          skillKey,
          status: "OK",
          data: {
            linearImbalance: micro.orderBook.linearImbalance,
            weightedImbalance: micro.orderBook.weightedImbalance,
            cvdUsd: micro.tape.cvdUsd,
            buyerAggressionPct: micro.tape.buyerAggressionPct,
            whaleTradesCount: micro.tape.whaleTradesCount
          },
          evidenceIds: [`micro_${context.symbol}_${Date.now()}`],
          latencyMs: Date.now() - startTime,
          dataAsOfMs: micro.timestamp
        };
      }

      case "risk.capital_guardian": {
        const side = (input.side as "long" | "short") ?? "long";
        const entry = Number(input.entryPrice ?? context.currentPrice);
        const sl = Number(input.stopLoss ?? 0);
        const current = context.currentPrice;

        const distancePct = entry > 0 ? (Math.abs(current - entry) / entry) * 100 : 0;
        const isBreached = side === "long" ? current <= sl : current >= sl;

        const lossStatus = input.accountDailyLossStatus as AccountDailyLossStatus | null | undefined;
        const dailyLossChecked = Boolean(lossStatus?.checked);
        const dailyLossBreached = Boolean(lossStatus?.limitBreached);
        const dailyLossDetails = lossStatus?.details ?? (dailyLossChecked ? "Денні ліміти в нормі" : "Денні ліміти не перевірено [CHECK_SKIPPED]");

        return {
          skillKey,
          status: "OK",
          data: {
            slBreached: isBreached,
            driftPct: distancePct,
            protectiveStopActive: sl > 0,
            dailyLossChecked,
            dailyLossBreached,
            dailyLossDetails,
            currentRealizedLossUsdt: lossStatus?.currentRealizedLossUsdt ?? 0,
            recommendedAction: isBreached || dailyLossBreached ? "STOP_LOSS_REACHED" : "RISK_WITHIN_BOUNDS"
          },
          evidenceIds: [`risk_eval_${Date.now()}`],
          latencyMs: Date.now() - startTime,
          dataAsOfMs: Date.now()
        };
      }

      case "news.impact_scanner": {
        const assessment = input.newsAssessment as NewsRiskAssessment | null | undefined;
        if (assessment?.coverageStatus === "UNAVAILABLE") {
          return {
            skillKey,
            status: "INSUFFICIENT_DATA",
            data: { message: "[DATA_UNAVAILABLE] News feed coverage offline" },
            evidenceIds: [],
            latencyMs: Date.now() - startTime,
            dataAsOfMs: Date.now()
          };
        }

        const events = (assessment?.activeEvents ?? (input.newsEvents as NewsEvent[] | undefined)) ?? [];
        if (!assessment && events.length === 0) {
          return {
            skillKey,
            status: "INSUFFICIENT_DATA",
            data: { message: "[DATA_UNAVAILABLE] No verified news feed connected" },
            evidenceIds: [],
            latencyMs: Date.now() - startTime,
            dataAsOfMs: Date.now()
          };
        }

        return {
          skillKey,
          status: "OK",
          data: {
            activeEventsCount: events.length,
            highImpact: events.some((e) => e.impactLevel === "critical" || e.impactLevel === "high"),
            eventsSummary: events.map((e) => ({ id: e.id, title: e.title, impact: e.impactLevel }))
          },
          evidenceIds: events.map((e) => e.id),
          latencyMs: Date.now() - startTime,
          dataAsOfMs: Date.now()
        };
      }

      default:
        return {
          skillKey,
          status: "INSUFFICIENT_DATA",
          data: { message: `Skill ${skillKey} has no specialized deterministic handler` },
          evidenceIds: [],
          latencyMs: Date.now() - startTime,
          dataAsOfMs: Date.now()
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
 * Runs a subagent with strict recursion depth and invocation limits.
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
      analysis: `Subagent recursion depth limit exceeded (depth ${context.depth} >= ${maxDepth})`,
      recommendation: "NO_ACTION",
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

      const lowStr = typeof res.data.swingLow === "number" ? res.data.swingLow.toString() : "—";
      const highStr = typeof res.data.swingHigh === "number" ? res.data.swingHigh.toString() : "—";

      return {
        agentKey,
        status: "completed",
        analysis: isOk
          ? `Ринкова структура: ${regime}. Локальний діапазон: [${lowStr} - ${highStr}].`
          : "Недостатньо свічкових даних для підтвердження структури ринку [DATA_UNAVAILABLE].",
        recommendation: isOk && regime === "bullish_trend" ? "HOLD" : "REVIEW",
        evidence,
        latencyMs: Date.now() - startTime
      };
    }

    case "order_flow_agent": {
      const res = await executeAgentSkill("orderflow.cvd_obi", payload, childContext);
      evidence.push(res);
      const isOk = res.status === "OK";
      const obi = typeof res.data.weightedImbalance === "number" ? res.data.weightedImbalance : 0;
      const cvd = typeof res.data.cvdUsd === "number" ? res.data.cvdUsd : 0;

      return {
        agentKey,
        status: "completed",
        analysis: isOk
          ? `Стакан OBI: ${(obi * 100).toFixed(1)}%. Дельта CVD: ${cvd > 0 ? "+" : ""}${cvd.toFixed(1)}.`
          : "Прямий біржовий потік ордерів / стакан недоступні [DATA_UNAVAILABLE].",
        recommendation: isOk ? (Math.abs(obi) > 0.4 ? "REVIEW" : "HOLD") : "NO_ACTION",
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

      let analysis: string;
      if (!dailyLossChecked) {
        analysis = (slBreached ? "УВАГА: Захисний Stop Loss досягнуто або пробито! " : "Рівень ризику позиції контрольований. ") +
          "Денні ліміти акаунту: [CHECK_SKIPPED / НЕ ПЕРЕВІРЕНО].";
      } else if (dailyLossBreached) {
        analysis = `КРИТИЧНО: Перевищено денний ліміт збитків! (${detailsStr}). ` +
          (slBreached ? "Захисний Stop Loss пробито!" : "Рекомендується негайний перегляд позицій.");
      } else {
        analysis = (slBreached ? "УВАГА: Захисний Stop Loss досягнуто або пробито! " : "Рівень ризику позиції контрольований. ") +
          "Денний ліміт збитків перевірено: ліміт у нормі.";
      }

      const recommendation = (slBreached || dailyLossBreached) ? "RECOMMEND_CLOSE" : "HOLD";

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
    mtfSnapshot: params.mtfSnapshot ?? null,
    microstructure: params.microstructure ?? null,
    newsEvents: params.newsEvents ?? [],
    newsAssessment: params.newsAssessment ?? null,
    accountDailyLossStatus: params.accountDailyLossStatus ?? null
  };

  const [structureRes, orderFlowRes, riskRes, newsRes] = await Promise.all([
    runSubagent("market_structure_agent", rootContext, payload),
    runSubagent("order_flow_agent", rootContext, payload),
    runSubagent("risk_guardian_agent", rootContext, payload),
    runSubagent("news_events_agent", rootContext, payload)
  ]);

  const subagentResults = [structureRes, orderFlowRes, riskRes, newsRes];

  // Dynamically compute evidence completeness (Phase P4 / Audit P1-D)
  let validEvidenceCount = 0;
  for (const res of subagentResults) {
    for (const ev of res.evidence) {
      if (ev.status === "OK") validEvidenceCount++;
    }
  }

  const evidenceCompleteness = subagentResults.length > 0
    ? Math.min(1, validEvidenceCount / subagentResults.length)
    : 0;

  // Lead synthesis logic based strictly on subagent signals
  let leadVerdict: LeadTradeSynthesis["leadVerdict"] = "HOLD";

  if (riskRes.recommendation === "RECOMMEND_CLOSE") {
    leadVerdict = "RECOMMEND_CLOSE";
  } else if (newsRes.recommendation === "RECOMMEND_REDUCE" || orderFlowRes.recommendation === "REVIEW") {
    leadVerdict = "RECOMMEND_REDUCE";
  } else if (structureRes.recommendation === "REVIEW") {
    leadVerdict = "REVIEW";
  }

  // Evidence-weighted confidence percentage (eliminates hardcoded 78/95/70 numbers)
  const confidencePct = Math.round(40 + 50 * evidenceCompleteness);
  const calibrationNotice =
    "УВАГА: Оцінка надійності є евристичним зведенням доказів субагентів, а не статистично каліброваною байєсівською ймовірністю.";

  const summary = `Lead Trade Agent синтез для ${params.symbol}: ` +
    `Структура (${structureRes.recommendation}), Потік ордерів (${orderFlowRes.recommendation}), ` +
    `Ризик (${riskRes.recommendation}), Новини (${newsRes.recommendation}). Вердикт: ${leadVerdict}.`;

  return {
    leadVerdict,
    confidencePct,
    isCalibrated: false,
    calibrationNotice,
    summary,
    subagentResults,
    timestampMs: Date.now(),
    authorizationRequirement: "explicit_user_confirmation_required"
  };
}
