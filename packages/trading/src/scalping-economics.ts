export interface ScalpingEconomicsInput {
  depositUsdt: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  leverage: number;
  riskPerTradePct: number;
  minimumNotionalUsdt: number;
  takerFeeBps: number;
  spreadBps: number;
  slippageBps: number;
}

export interface ScalpingEconomicsResult {
  feasible: boolean;
  reason: string | null;
  positionNotionalUsdt: number;
  marginUsedUsdt: number;
  riskBudgetUsdt: number;
  estimatedFeesUsdt: number;
  estimatedSpreadUsdt: number;
  estimatedSlippageUsdt: number;
  estimatedNetProfitUsdt: number;
  estimatedNetLossUsdt: number;
  rewardRiskAfterCosts: number | null;
}

const finitePositive = (value: number) => Number.isFinite(value) && value > 0;

/**
 * Cost-aware sizing for short-duration trades. This does not choose direction or
 * produce a signal; it validates whether an already-grounded setup is economical.
 */
export function calculateScalpingEconomics(input: ScalpingEconomicsInput): ScalpingEconomicsResult {
  const empty: ScalpingEconomicsResult = {
    feasible: false,
    reason: "Invalid market or account inputs",
    positionNotionalUsdt: 0,
    marginUsedUsdt: 0,
    riskBudgetUsdt: 0,
    estimatedFeesUsdt: 0,
    estimatedSpreadUsdt: 0,
    estimatedSlippageUsdt: 0,
    estimatedNetProfitUsdt: 0,
    estimatedNetLossUsdt: 0,
    rewardRiskAfterCosts: null
  };

  if (![input.depositUsdt, input.entryPrice, input.stopLossPrice, input.takeProfitPrice, input.leverage, input.riskPerTradePct].every(finitePositive)) return empty;

  const stopMovePct = Math.abs(input.entryPrice - input.stopLossPrice) / input.entryPrice;
  const rewardMovePct = Math.abs(input.takeProfitPrice - input.entryPrice) / input.entryPrice;
  if (!finitePositive(stopMovePct) || !finitePositive(rewardMovePct)) return empty;

  const leverage = Math.min(Math.max(input.leverage, 1), 100);
  const riskBudgetUsdt = input.depositUsdt * Math.min(Math.max(input.riskPerTradePct, 0.1), 100) / 100;
  const riskSizedNotional = riskBudgetUsdt / stopMovePct;
  const capitalCappedNotional = input.depositUsdt * 0.9 * leverage;
  const positionNotionalUsdt = Math.min(riskSizedNotional, capitalCappedNotional);
  const feeRate = Math.max(0, input.takerFeeBps) / 10_000;
  const spreadRate = Math.max(0, input.spreadBps) / 10_000;
  const slippageRate = Math.max(0, input.slippageBps) / 10_000;
  const estimatedFeesUsdt = positionNotionalUsdt * feeRate * 2;
  const estimatedSpreadUsdt = positionNotionalUsdt * spreadRate;
  const estimatedSlippageUsdt = positionNotionalUsdt * slippageRate * 2;
  const totalCosts = estimatedFeesUsdt + estimatedSpreadUsdt + estimatedSlippageUsdt;
  const estimatedNetProfitUsdt = positionNotionalUsdt * rewardMovePct - totalCosts;
  const estimatedNetLossUsdt = positionNotionalUsdt * stopMovePct + totalCosts;
  const rewardRiskAfterCosts = estimatedNetLossUsdt > 0 ? estimatedNetProfitUsdt / estimatedNetLossUsdt : null;

  let reason: string | null = null;
  if (positionNotionalUsdt < Math.max(0, input.minimumNotionalUsdt)) reason = "Position is below the exchange minimum notional";
  else if (estimatedNetProfitUsdt <= 0) reason = "Fees, spread and slippage consume the projected reward";
  else if (rewardRiskAfterCosts === null || rewardRiskAfterCosts < 1) reason = "Reward/risk falls below 1.0 after trading costs";

  return {
    feasible: reason === null,
    reason,
    positionNotionalUsdt,
    marginUsedUsdt: positionNotionalUsdt / leverage,
    riskBudgetUsdt,
    estimatedFeesUsdt,
    estimatedSpreadUsdt,
    estimatedSlippageUsdt,
    estimatedNetProfitUsdt,
    estimatedNetLossUsdt,
    rewardRiskAfterCosts
  };
}
