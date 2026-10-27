import type { Kline } from "@crypto-bot/shared";
import { calculateAdaptiveConfidence } from "./ai-learning";

export interface ExpectedValueParams {
  winProbabilityPct: number;
  riskUsd: number;
  rewardUsd: number;
  entryPrice: number;
  quantity?: number;
  roundtripFeeRate?: number; // default 0.0011 (0.055% open + 0.055% close on Bybit)
}

export interface ExpectedValueResult {
  evUsd: number;
  evPerDollarRisked: number;
  isPositiveEv: boolean;
  totalFeesUsd: number;
  pWin: number;
  pLoss: number;
}

/**
 * Calculates genuine mathematical expectation (EV) incorporating execution fees.
 * Formula: EV = (P_win * Reward) - (P_loss * Risk) - RoundtripFees
 */
export function calculateExpectedValue(params: ExpectedValueParams): ExpectedValueResult {
  const pWin = Math.max(0, Math.min(1, params.winProbabilityPct / 100));
  const pLoss = 1 - pWin;
  const feeRate = params.roundtripFeeRate ?? 0.0011;

  // Approximate notional position size from risk amount
  const notionalUsd = params.quantity && params.quantity > 0
    ? params.quantity * params.entryPrice
    : params.riskUsd * 10; // estimate 10x position if quantity not provided

  const totalFeesUsd = Number((notionalUsd * feeRate).toFixed(3));
  const evUsd = Number(((pWin * params.rewardUsd) - (pLoss * params.riskUsd) - totalFeesUsd).toFixed(2));
  const evPerDollarRisked = params.riskUsd > 0 ? Number((evUsd / params.riskUsd).toFixed(3)) : 0;

  return {
    evUsd,
    evPerDollarRisked,
    isPositiveEv: evUsd > 0,
    totalFeesUsd,
    pWin: Number(pWin.toFixed(4)),
    pLoss: Number(pLoss.toFixed(4))
  };
}

export interface MLPredictionRequest {
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  klines: Kline[];
  accountRiskUsd?: number;
}

export type MLModelType =
  | "CatBoostClassifier"
  | "StatisticalBayesian"
  | "RULE_HEURISTIC"
  | "MODEL_UNAVAILABLE"
  | "INSUFFICIENT_DATA";

export type MLStatus = "OK" | "MODEL_UNAVAILABLE" | "INSUFFICIENT_DATA" | "FALLBACK_RULE";

export interface MLPredictionResponse {
  symbol: string;
  side: "long" | "short";
  winProbabilityPct: number;
  expectedValueUsd: number;
  riskReward: number;
  decision: "TRADE" | "NO_TRADE";
  rejectionReason?: string | null;
  modelType: MLModelType;
  isFallback: boolean;
  status: MLStatus;
  topFeatures: string[];
}

/**
 * Queries the CatBoost Python ML inference service with transparent degraded fallback.
 * Follows Vexqora P0 safety rules: Never masquerades unverified fallbacks as trained models.
 */
export async function queryMLModelPrediction(
  req: MLPredictionRequest,
  customFetch: typeof fetch = fetch
): Promise<MLPredictionResponse> {
  const normSymbol = req.symbol.toUpperCase();
  const riskDist = Math.abs(req.entryPrice - req.stopLoss);
  const rewardDist = Math.abs(req.tp1 - req.entryPrice);
  const riskReward = riskDist > 0 ? Number((rewardDist / riskDist).toFixed(2)) : 1.8;
  const riskUsd = req.accountRiskUsd ?? 100;
  const rewardUsd = riskUsd * riskReward;

  const mlServiceUrl = (typeof process !== "undefined" && process.env?.ML_SERVICE_URL)
    ? process.env.ML_SERVICE_URL.replace(/\/+$/, "")
    : "http://127.0.0.1:8000";

  // 1. Attempt fast Python CatBoost microservice (400ms timeout)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 400);

    const res = await customFetch(`${mlServiceUrl}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: normSymbol,
        side: req.side,
        entryPrice: req.entryPrice,
        stopLoss: req.stopLoss,
        tp1: req.tp1,
        klines: req.klines,
        accountRiskUsd: riskUsd
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>;
      const rawModelType = typeof json.modelType === "string" ? json.modelType : "UNKNOWN";
      const isActualCatBoost = rawModelType === "CatBoostClassifier";

      let modelType: MLModelType;
      let isFallback: boolean;
      let status: MLStatus;

      if (isActualCatBoost) {
        modelType = "CatBoostClassifier";
        isFallback = false;
        status = "OK";
      } else if (rawModelType === "StatisticalBayesian") {
        modelType = "StatisticalBayesian";
        isFallback = true;
        status = "FALLBACK_RULE";
      } else if (rawModelType === "InsufficientDataFallback") {
        modelType = "INSUFFICIENT_DATA";
        isFallback = true;
        status = "INSUFFICIENT_DATA";
      } else {
        modelType = "RULE_HEURISTIC";
        isFallback = true;
        status = "FALLBACK_RULE";
      }

      return {
        symbol: normSymbol,
        side: req.side,
        winProbabilityPct: typeof json.winProbabilityPct === "number" ? json.winProbabilityPct : 50.0,
        expectedValueUsd: typeof json.expectedValueUsd === "number" ? json.expectedValueUsd : 0.0,
        riskReward: typeof json.riskReward === "number" ? json.riskReward : riskReward,
        decision: json.decision === "TRADE" && isActualCatBoost ? "TRADE" : "NO_TRADE",
        rejectionReason: typeof json.rejectionReason === "string"
          ? json.rejectionReason
          : (isActualCatBoost ? null : "Model is in Bayesian/Heuristic fallback mode (no trained .cbm CatBoost model loaded)"),
        modelType,
        isFallback,
        status,
        topFeatures: Array.isArray(json.topFeatures) ? (json.topFeatures as string[]) : []
      };
    }
  } catch {
    // Service offline or timeout -> proceed to transparent degraded fallback
  }

  // 2. Degraded Rule-Based Mode (explicitly marked as fallback, never pretending to be trained ML)
  const adaptive = calculateAdaptiveConfidence({
    symbol: normSymbol,
    side: req.side,
    baseWinRate: 64,
    klines: req.klines
  });

  const winProb = adaptive.confidencePct;
  const ev = calculateExpectedValue({
    winProbabilityPct: winProb,
    riskUsd,
    rewardUsd,
    entryPrice: req.entryPrice
  });

  const decision: "TRADE" | "NO_TRADE" = "NO_TRADE";
  let rejectionReason: string | null = "ML-сервіс недоступний (сервіс не відповідає на localhost:8000). Захисний режим NO_TRADE.";

  if (adaptive.decision === "NO_TRADE") {
    rejectionReason = adaptive.rejectionReason ?? rejectionReason;
  }

  return {
    symbol: normSymbol,
    side: req.side,
    winProbabilityPct: winProb,
    expectedValueUsd: ev.evUsd,
    riskReward,
    decision,
    rejectionReason,
    modelType: "MODEL_UNAVAILABLE",
    isFallback: true,
    status: "MODEL_UNAVAILABLE",
    topFeatures: []
  };
}
