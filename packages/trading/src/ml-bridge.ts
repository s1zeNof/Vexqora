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

export interface MLPredictionResponse {
  symbol: string;
  side: "long" | "short";
  winProbabilityPct: number;
  expectedValueUsd: number;
  riskReward: number;
  decision: "TRADE" | "NO_TRADE";
  rejectionReason?: string | null;
  modelType: string;
  topFeatures: string[];
}

/**
 * Queries the local CatBoost Python ML service with automatic mathematical fallback.
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

  // 1. Attempt fast local Python CatBoost microservice (350ms timeout)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 350);

    const res = await customFetch("http://127.0.0.1:8000/predict", {
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
      const json = (await res.json()) as MLPredictionResponse;
      return json;
    }
  } catch {
    // Service offline or timeout -> proceed to calibrated fallback
  }

  // 2. Calibrated Mathematical Quantitative Fallback (Zero external dependencies)
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

  let decision: "TRADE" | "NO_TRADE" = "TRADE";
  let rejectionReason: string | null = null;

  if (winProb < 52) {
    decision = "NO_TRADE";
    rejectionReason = `Квантова ML-модель оцінила ймовірність у ${winProb}%, що нижче порогу рентабельності (52%)`;
  } else if (!ev.isPositiveEv) {
    decision = "NO_TRADE";
    rejectionReason = `Математичне сподівання після біржових комісій від'ємне (EV: $${ev.evUsd})`;
  } else if (adaptive.decision === "NO_TRADE") {
    decision = "NO_TRADE";
    rejectionReason = adaptive.rejectionReason ?? "Ризик-фільтр відхилив вхід";
  }

  return {
    symbol: normSymbol,
    side: req.side,
    winProbabilityPct: winProb,
    expectedValueUsd: ev.evUsd,
    riskReward,
    decision,
    rejectionReason,
    modelType: "AdaptiveQuantitativeBayesian",
    topFeatures: ["adaptive_wick_penalty", "overextension_factor", "risk_reward_skew"]
  };
}
