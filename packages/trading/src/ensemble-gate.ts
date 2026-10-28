/**
 * Decision Ensemble Gates (P0-06)
 * Server-side gate verification with explicit GateEvidence: PASS | REJECTED | UNKNOWN.
 *
 * Guarantees:
 * 1. Missing data yields UNKNOWN, NEVER a fake PASS.
 * 2. Policy-driven fail-closed enforcement for new entries when mandatory gates are UNKNOWN.
 * 3. Fail-safe protection: protective exits / risk reductions are never blocked by missing LLM/ML/News.
 * 4. Deterministic risk/kill-switch checks always take precedence.
 */

export type GateStatus = "PASS" | "REJECTED" | "UNKNOWN";

export type OperationType = "NEW_ENTRY" | "RISK_REDUCTION" | "EMERGENCY_EXIT";

export interface GateEvidence<T = unknown> {
  status: GateStatus;
  reason: string;
  source?: string;
  dataAsOfMs?: number;
  details?: T;
}

export interface GatePolicy {
  /** If false, UNKNOWN structure status rejects new entries (fail-closed). Default false for automated discovery, true for manual. */
  allowUnknownStructureForEntry?: boolean;
  /** If false, UNKNOWN ML/EV status rejects new entries (fail-closed). */
  allowUnknownMlForEntry?: boolean;
  /** If false, UNKNOWN news status rejects new entries (fail-closed). */
  allowUnknownNewsForEntry?: boolean;
}

export interface ExecutionGateParams {
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  riskReward: number;
  operationType?: OperationType | undefined;
  policy?: GatePolicy | undefined;

  // Gate 1: Structure Alignment
  structureTrend?: "bullish" | "bearish" | "ranging" | "unknown" | undefined;
  structureEvidence?: GateEvidence | undefined;

  // Gate 2: ML & Quantitative EV
  evUsd?: number | undefined;
  winProbabilityPct?: number | null | undefined;
  mlDecision?: "TRADE" | "NO_TRADE" | "WAIT" | "UNKNOWN" | undefined;
  mlEvidence?: GateEvidence | undefined;

  // Gate 3: Risk Guardian & Account Safety (Deterministic)
  killSwitchActive?: boolean | undefined;
  dailyLossBreached?: boolean | undefined;

  // Gate 4: News & Execution Guard
  hasCriticalNews?: boolean | undefined;
  newsStatus?: "OK" | "CRITICAL_RISK" | "UNAVAILABLE" | "STALE" | undefined;
  newsEvidence?: GateEvidence | undefined;
}

export interface ExecutionGateResult {
  passed: boolean;
  verdict: "PASS" | "GATE_REJECTED";
  operationType: OperationType;
  gates: {
    gate1Structure: GateEvidence;
    gate2MlEv: GateEvidence;
    gate3Risk: GateEvidence;
    gate4ExecutionGuard: GateEvidence;
  };
  rejectionReasons: string[];
  warnings: string[];
}

const DEFAULT_POLICY: Required<GatePolicy> = {
  allowUnknownStructureForEntry: false,
  allowUnknownMlForEntry: false,
  allowUnknownNewsForEntry: false
};

/**
 * Validates candidate execution against all 4 backend gates.
 * Never fakes PASS for missing evidence.
 */
export function verifyExecutionGates(params: ExecutionGateParams): ExecutionGateResult {
  const opType = params.operationType ?? "NEW_ENTRY";
  const policy: Required<GatePolicy> = {
    allowUnknownStructureForEntry: params.policy?.allowUnknownStructureForEntry ?? DEFAULT_POLICY.allowUnknownStructureForEntry,
    allowUnknownMlForEntry: params.policy?.allowUnknownMlForEntry ?? DEFAULT_POLICY.allowUnknownMlForEntry,
    allowUnknownNewsForEntry: params.policy?.allowUnknownNewsForEntry ?? DEFAULT_POLICY.allowUnknownNewsForEntry
  };

  const rejectionReasons: string[] = [];
  const warnings: string[] = [];

  // Protective exits (emergency stop, risk reduction, manual close) must NEVER be blocked
  // by missing analytical gates (ML, News, Structure).
  const isProtectiveExit = opType === "EMERGENCY_EXIT" || opType === "RISK_REDUCTION";

  // ==========================================
  // Gate 1: Structure Alignment
  // ==========================================
  let gate1: GateEvidence;
  if (params.structureEvidence) {
    gate1 = params.structureEvidence;
    if (gate1.status === "REJECTED") {
      rejectionReasons.push(gate1.reason);
    } else if (gate1.status === "UNKNOWN" && !isProtectiveExit && !policy.allowUnknownStructureForEntry) {
      rejectionReasons.push(`Gate 1 (Structure): Новий вхід заблоковано через непідтверджену структуру (policy: fail-closed).`);
    }
  } else if (params.structureTrend === undefined || params.structureTrend === "unknown") {
    gate1 = {
      status: "UNKNOWN",
      reason: "Ринкова структура не перевірена (UNKNOWN). Відсутні підтверджені swing-рівні або trend."
    };
    if (!isProtectiveExit) {
      if (!policy.allowUnknownStructureForEntry) {
        rejectionReasons.push("Gate 1 (Structure): Новий вхід заблоковано через відсутність перевіреної ринкової структури (fail-closed).");
      } else {
        warnings.push("Gate 1 (Structure) статус UNKNOWN: вхід дозволено за поточною політикою.");
      }
    }
  } else if (params.side === "long" && params.structureTrend === "bearish") {
    gate1 = {
      status: "REJECTED",
      reason: "Вхід у LONG заборонено проти чіткого спадного (BEARISH) тренду без підтвердженого CHOCH."
    };
    if (!isProtectiveExit) rejectionReasons.push(gate1.reason);
  } else if (params.side === "short" && params.structureTrend === "bullish") {
    gate1 = {
      status: "REJECTED",
      reason: "Вхід у SHORT заборонено проти чіткого висхідного (BULLISH) тренду без підтвердженого CHOCH."
    };
    if (!isProtectiveExit) rejectionReasons.push(gate1.reason);
  } else {
    gate1 = {
      status: "PASS",
      reason: "Ринкова структура валідна або в межах допустимого коридору."
    };
  }

  // ==========================================
  // Gate 2: ML & Expected Value (Quantitative)
  // ==========================================
  let gate2: GateEvidence;
  if (params.mlEvidence) {
    gate2 = params.mlEvidence;
    if (gate2.status === "REJECTED") {
      rejectionReasons.push(gate2.reason);
    } else if (gate2.status === "UNKNOWN" && !isProtectiveExit && !policy.allowUnknownMlForEntry) {
      rejectionReasons.push(`Gate 2 (ML/EV): Новий вхід заблоковано через відсутність ML/EV підтвердження (fail-closed).`);
    }
  } else if (params.evUsd !== undefined && params.evUsd < 0) {
    gate2 = {
      status: "REJECTED",
      reason: `Математичне сподівання угоди від'ємне (EV = ${params.evUsd} USD з урахуванням біржових комісій).`
    };
    if (!isProtectiveExit) rejectionReasons.push(gate2.reason);
  } else if (params.winProbabilityPct !== undefined && params.winProbabilityPct !== null && params.winProbabilityPct < 45.0) {
    gate2 = {
      status: "REJECTED",
      reason: `Калібрована ймовірність успіху занадто низька (${params.winProbabilityPct}% < 45%).`
    };
    if (!isProtectiveExit) rejectionReasons.push(gate2.reason);
  } else if (params.mlDecision === "NO_TRADE") {
    gate2 = {
      status: "REJECTED",
      reason: "Модельний шар надав остаточний вердикт NO_TRADE."
    };
    if (!isProtectiveExit) rejectionReasons.push(gate2.reason);
  } else if (params.evUsd === undefined && params.mlDecision === undefined && (params.winProbabilityPct === undefined || params.winProbabilityPct === null)) {
    gate2 = {
      status: "UNKNOWN",
      reason: "ML / EV статус не визначено (модельний шар недоступний або не запущений)."
    };
    if (!isProtectiveExit) {
      if (!policy.allowUnknownMlForEntry) {
        rejectionReasons.push("Gate 2 (ML/EV): Новий вхід заблоковано через відсутність ML/EV підтвердження (fail-closed).");
      } else {
        warnings.push("Gate 2 (ML/EV) статус UNKNOWN: вхід дозволено за поточною політикою.");
      }
    }
  } else {
    gate2 = {
      status: "PASS",
      reason: "Математичне очікування (EV) та модельні метрики у нормі."
    };
  }

  // ==========================================
  // Gate 3: Risk Guardian & Account Safety (Deterministic)
  // ==========================================
  let gate3: GateEvidence;
  if (params.killSwitchActive && !isProtectiveExit) {
    gate3 = {
      status: "REJECTED",
      reason: "Активовано аварійний Kill-Switch акаунту. Нові входи заборонені."
    };
    rejectionReasons.push(gate3.reason);
  } else if (params.dailyLossBreached && !isProtectiveExit) {
    gate3 = {
      status: "REJECTED",
      reason: "Перевищено денний ліміт максимальних збитків (Max Daily Loss). Торгівля призупинена."
    };
    rejectionReasons.push(gate3.reason);
  } else if (params.riskReward < 1.0 && !isProtectiveExit) {
    gate3 = {
      status: "REJECTED",
      reason: `Співвідношення Risk:Reward (${params.riskReward.toFixed(2)}) нижче мінімального допустимого порогу 1.0.`
    };
    rejectionReasons.push(gate3.reason);
  } else if (params.side === "long" && params.stopLoss >= params.entryPrice && !isProtectiveExit) {
    gate3 = {
      status: "REJECTED",
      reason: `Stop Loss для LONG (${params.stopLoss}) повинен бути суворо нижче ціни входу (${params.entryPrice}).`
    };
    rejectionReasons.push(gate3.reason);
  } else if (params.side === "short" && params.stopLoss <= params.entryPrice && !isProtectiveExit) {
    gate3 = {
      status: "REJECTED",
      reason: `Stop Loss для SHORT (${params.stopLoss}) повинен бути суворо вище ціни входу (${params.entryPrice}).`
    };
    rejectionReasons.push(gate3.reason);
  } else {
    gate3 = {
      status: "PASS",
      reason: isProtectiveExit
        ? "Захисна операція: ризикові обмеження дозволяють закриття/зменшення позиції."
        : "Ризикові ліміти, стоп-лосс та R:R у межах норми."
    };
  }

  // ==========================================
  // Gate 4: News & Execution Guard
  // ==========================================
  let gate4: GateEvidence;
  if (params.newsEvidence) {
    gate4 = params.newsEvidence;
    if (gate4.status === "REJECTED") {
      rejectionReasons.push(gate4.reason);
    } else if (gate4.status === "UNKNOWN" && !isProtectiveExit && !policy.allowUnknownNewsForEntry) {
      rejectionReasons.push(`Gate 4 (News): Новий вхід заблоковано через відсутність перевірених новинних даних (fail-closed).`);
    }
  } else if (params.hasCriticalNews === true || params.newsStatus === "CRITICAL_RISK") {
    gate4 = {
      status: "REJECTED",
      reason: "Виявлено критичну новинну подію з високим ризиком екстремальної волатильності або ліквідаційного гепу."
    };
    if (!isProtectiveExit) rejectionReasons.push(gate4.reason);
  } else if (params.newsStatus === "UNAVAILABLE" || (params.hasCriticalNews === undefined && params.newsStatus === undefined)) {
    gate4 = {
      status: "UNKNOWN",
      reason: "Дані новинного сервісу недоступні (UNAVAILABLE або не передані). Статус ринкових подій не верифіковано."
    };
    if (!isProtectiveExit) {
      if (!policy.allowUnknownNewsForEntry) {
        rejectionReasons.push("Gate 4 (News): Новий вхід заблоковано через відсутність перевірених новинних даних (fail-closed).");
      } else {
        warnings.push("Gate 4 (News) статус UNKNOWN: вхід дозволено за поточною політикою.");
      }
    }
  } else {
    gate4 = {
      status: "PASS",
      reason: "Критичних новинних загроз не виявлено, стан ринку стабільний."
    };
  }

  const passed = rejectionReasons.length === 0;

  return {
    passed,
    verdict: passed ? "PASS" : "GATE_REJECTED",
    operationType: opType,
    gates: {
      gate1Structure: gate1,
      gate2MlEv: gate2,
      gate3Risk: gate3,
      gate4ExecutionGuard: gate4
    },
    rejectionReasons,
    warnings
  };
}
