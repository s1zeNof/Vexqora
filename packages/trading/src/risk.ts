import type { InstrumentInfo, Signal } from "@crypto-bot/shared";

export interface RiskSettings {
  riskPerTradePct: number;
  maxLeverage: number;
  maxOpenPositions: number;
  maxDailyLossPct: number;
  allowedSymbols?: string[];
  killSwitch: boolean;
}

export interface TradeContext {
  balance: number;
  marketPrice: number;
  openPositions: number;
  dailyPnl: number;
  customMargin?: number | undefined;
}

export interface TradePreview {
  signal: Signal;
  entryPrice: number;
  qty: number;
  qtyStep: number;
  tickSize: number;
  notional: number;
  riskAmount: number;
  riskPct: number;
  leverage: number;
  weightedRewardRisk: number;
}

export class RiskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RiskValidationError";
  }
}

function decimals(step: number): number {
  const text = step.toString().toLowerCase();
  if (text.includes("e-")) return Number(text.split("e-")[1]);
  return text.includes(".") ? (text.split(".")[1]?.length ?? 0) : 0;
}

export function roundToStep(value: number, step: number, mode: "nearest" | "down" = "nearest"): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) throw new Error("Value and step must be finite; step must be positive");
  const units = mode === "down" ? Math.floor((value + Number.EPSILON) / step) : Math.round(value / step);
  return Number((units * step).toFixed(decimals(step)));
}

function entryPrice(signal: Signal, marketPrice: number): number {
  if (signal.entry.type === "market") return marketPrice;
  if (signal.entry.type === "limit") return signal.entry.price;
  return (signal.entry.from + signal.entry.to) / 2;
}

export function createTradePreview(
  original: Signal,
  instrument: InstrumentInfo,
  settings: RiskSettings,
  context: TradeContext
): TradePreview {
  if (settings.killSwitch) throw new RiskValidationError("Kill switch is active");
  if (context.openPositions >= settings.maxOpenPositions) throw new RiskValidationError("Maximum open positions reached");
  if (context.dailyPnl < 0 && Math.abs(context.dailyPnl) >= context.balance * settings.maxDailyLossPct / 100) {
    throw new RiskValidationError("Maximum daily loss reached");
  }
  if (settings.allowedSymbols?.length && !settings.allowedSymbols.includes(original.symbol)) {
    throw new RiskValidationError(`${original.symbol} is not in the allowed-symbol list`);
  }

  const normalizedEntry = roundToStep(entryPrice(original, context.marketPrice), instrument.tickSize);
  const stopLoss = roundToStep(original.stopLoss, instrument.tickSize);
  const takeProfits = original.takeProfits.map((target) => ({ ...target, price: roundToStep(target.price, instrument.tickSize) }));
  if (original.side === "long") {
    if (stopLoss >= normalizedEntry) throw new RiskValidationError("Long stop loss must be below entry");
    if (takeProfits.some(({ price }) => price <= normalizedEntry)) throw new RiskValidationError("Long take profits must be above entry");
    if (takeProfits.some((target, index) => index > 0 && target.price <= takeProfits[index - 1]!.price)) throw new RiskValidationError("Long take profits must be strictly ascending");
  } else {
    if (stopLoss <= normalizedEntry) throw new RiskValidationError("Short stop loss must be above entry");
    if (takeProfits.some(({ price }) => price >= normalizedEntry)) throw new RiskValidationError("Short take profits must be below entry");
    if (takeProfits.some((target, index) => index > 0 && target.price >= takeProfits[index - 1]!.price)) throw new RiskValidationError("Short take profits must be strictly descending");
  }

  const leverage = original.leverage ?? settings.maxLeverage;
  if (!Number.isInteger(leverage) || leverage < 1) throw new RiskValidationError("Leverage must be a positive integer");
  if (leverage > settings.maxLeverage) throw new RiskValidationError("Leverage exceeds account risk settings");
  if (leverage > instrument.maxLeverage) throw new RiskValidationError("Leverage exceeds instrument limit");
  const riskPct = original.riskPct ?? settings.riskPerTradePct;
  if (riskPct <= 0 || riskPct > settings.riskPerTradePct) throw new RiskValidationError("Risk exceeds account risk settings");
  const stopDistance = Math.abs(normalizedEntry - stopLoss);
  let qty: number;
  const riskBudget = context.balance * riskPct / 100;

  if (context.customMargin && context.customMargin > 0) {
    const customLeverageQty = (context.customMargin * leverage) / normalizedEntry;
    qty = roundToStep(customLeverageQty, instrument.qtyStep, "down");
    if (qty < instrument.minQty) {
      qty = instrument.minQty;
    }
  } else {
    const riskQty = riskBudget / stopDistance;
    const leverageQty = context.balance * leverage / normalizedEntry;
    qty = roundToStep(Math.min(riskQty, leverageQty), instrument.qtyStep, "down");
    if (qty < instrument.minQty) throw new RiskValidationError("Calculated quantity is below the instrument minimum");
    if (qty * stopDistance > riskBudget + instrument.qtyStep * stopDistance) throw new RiskValidationError("Calculated risk exceeds the risk budget");
  }

  const notional = qty * normalizedEntry;
  if (notional < instrument.minNotional) throw new RiskValidationError("Calculated notional is below the instrument minimum");
  const riskAmount = qty * stopDistance;
  const calculatedRiskPct = context.balance > 0 ? (riskAmount / context.balance) * 100 : riskPct;
  const weightedReward = takeProfits.reduce((sum, target) => sum + Math.abs(target.price - normalizedEntry) * target.sharePct / 100, 0);

  return {
    signal: {
      ...original,
      entry: original.entry.type === "market" ? original.entry : original.entry.type === "limit"
        ? { type: "limit", price: normalizedEntry }
        : { type: "range", from: roundToStep(original.entry.from, instrument.tickSize), to: roundToStep(original.entry.to, instrument.tickSize) },
      stopLoss,
      takeProfits
    },
    entryPrice: normalizedEntry,
    qty,
    qtyStep: instrument.qtyStep,
    tickSize: instrument.tickSize,
    notional,
    riskAmount,
    riskPct: calculatedRiskPct,
    leverage,
    weightedRewardRisk: weightedReward / stopDistance
  };
}

