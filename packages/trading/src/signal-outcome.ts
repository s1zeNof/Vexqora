export type SignalOutcomeStatus = "monitoring" | "tp1_hit" | "tp2_hit" | "won" | "failed" | "expired";

export interface SignalOutcomeSnapshot {
  side: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number | null;
  tp3: number | null;
  status: SignalOutcomeStatus;
  maxFavorablePct: number;
  maxAdversePct: number;
  expiresAt: string;
}

export interface SignalOutcomeEvaluation {
  status: SignalOutcomeStatus;
  maxFavorablePct: number;
  maxAdversePct: number;
  tp1Hit: boolean;
  tp2Hit: boolean;
  tp3Hit: boolean;
  stopHit: boolean;
  resolved: boolean;
  outcome: "win" | "loss" | "partial" | "no_trigger" | null;
  failureReason: string | null;
}

export type TradeLossRootCause =
  | "liquidity_sweep"
  | "wrong_direction"
  | "overextension"
  | "sl_tight"
  | "high_impact_news"
  | "manual_intervention"
  | "stop_loss_hit";

export interface TradeLossAttributionParams {
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  maxAdversePct: number;
  maxFavorablePct: number;
  entry24hChangePct?: number;
  atrPct?: number;
  hasActiveCriticalNews?: boolean;
  exitReason?: string;
}

export interface TradeLossAttributionResult {
  rootCause: TradeLossRootCause;
  attributionMethod: "HEURISTIC_RULE_ATTRIBUTION";
  isEmpiricalModelTrained: false;
  details: string;
}

/**
 * Classifies the specific root cause for a trade loss (Phase P5 Continuous Learning)
 * Explicitly identified as HEURISTIC_RULE_ATTRIBUTION (deterministic rules, not trained ML).
 */
export function classifyTradeLossRootCause(params: TradeLossAttributionParams): TradeLossRootCause {
  if (params.exitReason === "manual") {
    return "manual_intervention";
  }

  if (params.hasActiveCriticalNews) {
    return "high_impact_news";
  }

  const slDistPct = params.entryPrice > 0
    ? (Math.abs(params.entryPrice - params.stopLoss) / params.entryPrice) * 100
    : 2.0;

  if (slDistPct < 1.0 || (params.atrPct && slDistPct < params.atrPct * 1.1)) {
    return "sl_tight";
  }

  if (params.entry24hChangePct && Math.abs(params.entry24hChangePct) >= 8.0) {
    return "overextension";
  }

  // If maximum favorable move was > 0.8% before stop hit, it was a sweep/reversal
  if (params.maxFavorablePct >= 0.8 && params.maxFavorablePct < 1.8) {
    return "liquidity_sweep";
  }

  // If trade immediately drifted adversely without any favorable move
  if (params.maxFavorablePct < 0.2 && params.maxAdversePct >= slDistPct) {
    return "wrong_direction";
  }

  return "stop_loss_hit";
}

/**
 * Attributes a trade loss with explicit provenance and non-ML heuristic disclaimer.
 */
export function attributeTradeLoss(params: TradeLossAttributionParams): TradeLossAttributionResult {
  const rootCause = classifyTradeLossRootCause(params);
  return {
    rootCause,
    attributionMethod: "HEURISTIC_RULE_ATTRIBUTION",
    isEmpiricalModelTrained: false,
    details: `Loss attributed via deterministic heuristics (${rootCause}). Model retrain not yet applied.`
  };
}

export interface TradeLearningRecord {
  id: string;
  tradeId?: string;
  signalId?: string;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  realizedPnl: number;
  outcome: "win" | "loss" | "partial" | "breakeven";
  rootCause: string;
  attributionMethod: "HEURISTIC_RULE_ATTRIBUTION";
  isEmpirical: boolean;
  modelProvenance: {
    modelVersion: string;
    featuresSnapshot: Record<string, number>;
  };
  createdAt: string;
}

export function evaluateSignalOutcome(
  signal: SignalOutcomeSnapshot,
  currentPrice: number,
  now = new Date()
): SignalOutcomeEvaluation {
  const direction = signal.side === "long" ? 1 : -1;
  const movePct = ((currentPrice - signal.entryPrice) / signal.entryPrice) * 100 * direction;
  const maxFavorablePct = Math.max(signal.maxFavorablePct, movePct, 0);
  const maxAdversePct = Math.max(signal.maxAdversePct, -movePct, 0);
  const reached = (level: number) => signal.side === "long" ? currentPrice >= level : currentPrice <= level;
  const stopHit = signal.side === "long" ? currentPrice <= signal.stopLoss : currentPrice >= signal.stopLoss;
  const priorTp1 = signal.status === "tp1_hit" || signal.status === "tp2_hit" || signal.status === "won";
  const priorTp2 = signal.status === "tp2_hit" || signal.status === "won";
  const tp1Hit = priorTp1 || reached(signal.tp1);
  const tp2Hit = priorTp2 || (signal.tp2 !== null && reached(signal.tp2));
  const tp3Hit = signal.status === "won" || (signal.tp3 !== null && reached(signal.tp3));

  if (stopHit) {
    return {
      status: "failed", maxFavorablePct, maxAdversePct, tp1Hit, tp2Hit, tp3Hit: false,
      stopHit: true, resolved: true, outcome: tp1Hit ? "partial" : "loss",
      failureReason: tp1Hit ? "stop_loss_after_partial_profit" : "stop_loss_before_tp1"
    };
  }
  if (tp3Hit || (signal.tp3 === null && tp2Hit) || (signal.tp2 === null && tp1Hit)) {
    return {
      status: "won", maxFavorablePct, maxAdversePct, tp1Hit: true, tp2Hit, tp3Hit,
      stopHit: false, resolved: true, outcome: "win", failureReason: null
    };
  }
  if (now.getTime() >= new Date(signal.expiresAt).getTime()) {
    return {
      status: "expired", maxFavorablePct, maxAdversePct, tp1Hit, tp2Hit, tp3Hit,
      stopHit: false, resolved: true, outcome: tp1Hit ? "partial" : "no_trigger",
      failureReason: tp1Hit ? "expired_after_partial_targets" : "expired_without_tp1"
    };
  }

  return {
    status: tp2Hit ? "tp2_hit" : tp1Hit ? "tp1_hit" : "monitoring",
    maxFavorablePct, maxAdversePct, tp1Hit, tp2Hit, tp3Hit,
    stopHit: false, resolved: false, outcome: null, failureReason: null
  };
}
