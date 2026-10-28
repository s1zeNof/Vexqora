import type { Kline } from "@crypto-bot/shared";
import { calculateAdaptiveConfidence } from "./ai-learning";

export interface ExpectedValueParams {
  winProbabilityPct: number | null;
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
 * If winProbabilityPct is null (uncalibrated / model offline), EV is 0 and isPositiveEv is false.
 */
export function calculateExpectedValue(params: ExpectedValueParams): ExpectedValueResult {
  if (params.winProbabilityPct === null || params.winProbabilityPct === undefined) {
    return {
      evUsd: 0,
      evPerDollarRisked: 0,
      isPositiveEv: false,
      totalFeesUsd: 0,
      pWin: 0,
      pLoss: 0
    };
  }

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
  winProbabilityPct: number | null;
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
 * Strictly adheres to P0 / P0-11 safety rules:
 * - When ML server is offline or uncalibrated, winProbabilityPct is NULL (never a fabricated number).
 * - Degraded fallback decisions default to NO_TRADE.
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

      if (isActualCatBoost && typeof json.winProbabilityPct === "number") {
        return {
          symbol: normSymbol,
          side: req.side,
          winProbabilityPct: json.winProbabilityPct,
          expectedValueUsd: typeof json.expectedValueUsd === "number" ? json.expectedValueUsd : 0.0,
          riskReward: typeof json.riskReward === "number" ? json.riskReward : riskReward,
          decision: json.decision === "TRADE" ? "TRADE" : "NO_TRADE",
          rejectionReason: typeof json.rejectionReason === "string" ? json.rejectionReason : null,
          modelType: "CatBoostClassifier",
          isFallback: false,
          status: "OK",
          topFeatures: Array.isArray(json.topFeatures) ? (json.topFeatures as string[]) : []
        };
      }

      // If response was Bayesian / heuristic fallback from Python:
      return {
        symbol: normSymbol,
        side: req.side,
        winProbabilityPct: null, // Null without empirical weights
        expectedValueUsd: 0.0,
        riskReward: typeof json.riskReward === "number" ? json.riskReward : riskReward,
        decision: "NO_TRADE",
        rejectionReason: "Модель у евристичному режимі: відсутній навчений .cbm файл CatBoost. Калібрована ймовірність: null.",
        modelType: "StatisticalBayesian",
        isFallback: true,
        status: "FALLBACK_RULE",
        topFeatures: Array.isArray(json.topFeatures) ? (json.topFeatures as string[]) : []
      };
    }
  } catch {
    // Service offline or timeout -> proceed to degraded fallback
  }

  // 2. Degraded Offline Mode (explicitly marked as MODEL_UNAVAILABLE, null probability)
  const adaptive = calculateAdaptiveConfidence({
    symbol: normSymbol,
    side: req.side,
    baseScore: 50,
    klines: req.klines
  });

  return {
    symbol: normSymbol,
    side: req.side,
    winProbabilityPct: null, // Contract requirement: null without calibrated model
    expectedValueUsd: 0.0,
    riskReward,
    decision: "NO_TRADE",
    rejectionReason: adaptive.decision === "NO_TRADE" && adaptive.rejectionReason
      ? adaptive.rejectionReason
      : "ML-сервіс недоступний (127.0.0.1:8000). Відсутня підтверджена .cbm модель. Калібрована ймовірність: null. Режим NO_TRADE.",
    modelType: "MODEL_UNAVAILABLE",
    isFallback: true,
    status: "MODEL_UNAVAILABLE",
    topFeatures: []
  };
}
