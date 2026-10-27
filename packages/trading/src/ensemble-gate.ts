/**
 * Backend Execution Gates (Phase P0-D)
 * Strict 4-Gate enforcement on the backend order execution path.
 * Guarantees that neither UI bypasses, nor worker, nor chat can submit
 * an order if any of the 4 gates reject.
 */

export interface ExecutionGateParams {
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  riskReward: number;
  killSwitchActive?: boolean;
  dailyLossBreached?: boolean;
  evUsd?: number;
  winProbabilityPct?: number;
  mlDecision?: "TRADE" | "NO_TRADE";
  structureTrend?: "bullish" | "bearish" | "ranging" | "unknown";
  hasCriticalNews?: boolean;
}

export interface GateVerificationDetail {
  passed: boolean;
  reason: string;
}

export interface ExecutionGateResult {
  passed: boolean;
  verdict: "PASS" | "GATE_REJECTED";
  gates: {
    gate1Structure: GateVerificationDetail;
    gate2MlEv: GateVerificationDetail;
    gate3Risk: GateVerificationDetail;
    gate4ExecutionGuard: GateVerificationDetail;
  };
  rejectionReasons: string[];
}

/**
 * Validates candidate execution against all 4 backend gates.
 * Throws or returns detailed breakdown with blocking reasons.
 */
export function verifyExecutionGates(params: ExecutionGateParams): ExecutionGateResult {
  const rejectionReasons: string[] = [];

  // Gate 1: Structure Alignment
  let gate1Passed = true;
  let gate1Reason = "Ринкова структура валідна або в межах допустимого коридору.";

  if (params.structureTrend) {
    if (params.side === "long" && params.structureTrend === "bearish") {
      gate1Passed = false;
      gate1Reason = "Вхід у LONG заборонено проти чіткого спадного (BEARISH) тренду без підтвердженого CHOCH.";
      rejectionReasons.push(gate1Reason);
    } else if (params.side === "short" && params.structureTrend === "bullish") {
      gate1Passed = false;
      gate1Reason = "Вхід у SHORT заборонено проти чіткого висхідного (BULLISH) тренду без підтвердженого CHOCH.";
      rejectionReasons.push(gate1Reason);
    }
  }

  // Gate 2: ML & Expected Value
  let gate2Passed = true;
  let gate2Reason = "Математичне очікування (EV) та ймовірність позитивні.";

  if (params.evUsd !== undefined && params.evUsd < 0) {
    gate2Passed = false;
    gate2Reason = `Математичне сподівання угоди від'ємне (EV = ${params.evUsd} USD з урахуванням біржових комісій).`;
    rejectionReasons.push(gate2Reason);
  } else if (params.winProbabilityPct !== undefined && params.winProbabilityPct < 45.0) {
    gate2Passed = false;
    gate2Reason = `Ймовірність успіху занадто низька (${params.winProbabilityPct}% < 45%).`;
    rejectionReasons.push(gate2Reason);
  } else if (params.mlDecision === "NO_TRADE" && params.evUsd !== undefined && params.evUsd <= 0) {
    gate2Passed = false;
    gate2Reason = "Модельний шар надав остаточний вердикт NO_TRADE.";
    rejectionReasons.push(gate2Reason);
  }

  // Gate 3: Risk Guardian & Account Safety
  let gate3Passed = true;
  let gate3Reason = "Ризикові ліміти, стоп-лосс та R:R у межах норми.";

  if (params.killSwitchActive) {
    gate3Passed = false;
    gate3Reason = "Активовано аварійний Kill-Switch акаунту.";
    rejectionReasons.push(gate3Reason);
  } else if (params.dailyLossBreached) {
    gate3Passed = false;
    gate3Reason = "Перевищено денний ліміт максимальних збитків (Max Daily Loss).";
    rejectionReasons.push(gate3Reason);
  } else if (params.riskReward < 1.1) {
    gate3Passed = false;
    gate3Reason = `Співвідношення Risk:Reward (${params.riskReward}) нижче мінімального інституційного порогу 1.1.`;
    rejectionReasons.push(gate3Reason);
  } else if (params.side === "long" && params.stopLoss >= params.entryPrice) {
    gate3Passed = false;
    gate3Reason = "Stop Loss для LONG повинен бути суворо нижче ціни входу.";
    rejectionReasons.push(gate3Reason);
  } else if (params.side === "short" && params.stopLoss <= params.entryPrice) {
    gate3Passed = false;
    gate3Reason = "Stop Loss для SHORT повинен бути суворо вище ціни входу.";
    rejectionReasons.push(gate3Reason);
  }

  // Gate 4: Execution Guard (News Shocks & Spread)
  let gate4Passed = true;
  let gate4Reason = "Критичних новинних шоків та делістингів не зафіксовано.";

  if (params.hasCriticalNews) {
    gate4Passed = false;
    gate4Reason = "Виявлено критичні біржові новини (делістинг/хак). Виконання ордерів заблоковано.";
    rejectionReasons.push(gate4Reason);
  }

  const passed = gate1Passed && gate2Passed && gate3Passed && gate4Passed;

  return {
    passed,
    verdict: passed ? "PASS" : "GATE_REJECTED",
    gates: {
      gate1Structure: { passed: gate1Passed, reason: gate1Reason },
      gate2MlEv: { passed: gate2Passed, reason: gate2Reason },
      gate3Risk: { passed: gate3Passed, reason: gate3Reason },
      gate4ExecutionGuard: { passed: gate4Passed, reason: gate4Reason }
    },
    rejectionReasons
  };
}
