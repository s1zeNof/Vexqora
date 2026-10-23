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
