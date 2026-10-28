import type { ExchangeClient, OrderAck } from "@crypto-bot/shared";
import { roundToStep, type TradePreview } from "./risk";
import { verifyExecutionGates, type ExecutionGateParams, type GatePolicy } from "./ensemble-gate";

export type TradeStatus = "pending" | "entry_open" | "active" | "closed" | "cancelled" | "failed";

export type TradeEvent =
  | { type: "ENTRY_SUBMITTED" }
  | { type: "ENTRY_FILLED" }
  | { type: "POSITION_CLOSED" }
  | { type: "CANCELLED" }
  | { type: "FAILED" };

export function reduceTradeStatus(current: TradeStatus, event: TradeEvent): TradeStatus {
  const transitions: Partial<Record<TradeStatus, Partial<Record<TradeEvent["type"], TradeStatus>>>> = {
    pending: { ENTRY_SUBMITTED: "entry_open", CANCELLED: "cancelled", FAILED: "failed" },
    entry_open: { ENTRY_FILLED: "active", CANCELLED: "cancelled", FAILED: "failed" },
    active: { POSITION_CLOSED: "closed", FAILED: "failed" }
  };
  const next = transitions[current]?.[event.type];
  if (!next) throw new Error(`Invalid trade transition: ${current} -> ${event.type}`);
  return next;
}

export interface EntrySubmission {
  entryOrder: OrderAck;
  status: "entry_open";
}

export function verifyEntrySubmission(
  preview: TradePreview,
  options?: {
    evidence?: Partial<ExecutionGateParams> | undefined;
    policy?: GatePolicy | undefined;
  }
) {
  return verifyExecutionGates({
    symbol: preview.signal.symbol,
    side: preview.signal.side,
    entryPrice: preview.entryPrice,
    stopLoss: preview.signal.stopLoss,
    tp1: preview.signal.takeProfits[0]?.price ?? preview.entryPrice,
    riskReward: preview.weightedRewardRisk,
    operationType: "NEW_ENTRY",
    structureTrend: options?.evidence?.structureTrend,
    structureEvidence: options?.evidence?.structureEvidence,
    mlDecision: options?.evidence?.mlDecision,
    mlEvidence: options?.evidence?.mlEvidence,
    winProbabilityPct: options?.evidence?.winProbabilityPct,
    evUsd: options?.evidence?.evUsd,
    hasCriticalNews: options?.evidence?.hasCriticalNews,
    newsStatus: options?.evidence?.newsStatus,
    newsEvidence: options?.evidence?.newsEvidence,
    policy: options?.policy
  });
}

function orderLinkId(prefix: string, tradeId: string, suffix: string): string {
  const safe = tradeId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${prefix}-${safe}-${suffix}`.slice(0, 36);
}

export async function submitEntry(
  client: ExchangeClient,
  preview: TradePreview,
  tradeId: string,
  options?: {
    evidence?: Partial<ExecutionGateParams> | undefined;
    policy?: GatePolicy | undefined;
  }
): Promise<EntrySubmission> {
  const gateCheck = verifyEntrySubmission(preview, options);

  if (!gateCheck.passed) {
    throw new Error(`Execution blocked by Decision Ensemble Gate: ${gateCheck.rejectionReasons.join("; ")}`);
  }

  await client.setLeverage(preview.signal.symbol, preview.leverage);
  const side = preview.signal.side === "long" ? "buy" : "sell";
  const entry = preview.signal.entry;
  const entryOrder = await client.placeOrder({
    symbol: preview.signal.symbol,
    side,
    type: entry.type === "market" ? "market" : "limit",
    qty: preview.qty,
    ...(entry.type === "limit" ? { price: entry.price } : {}),
    ...(entry.type === "range" ? { price: entry.from } : {}),
    orderLinkId: orderLinkId("entry", tradeId, "0")
  });
  return { entryOrder, status: "entry_open" };
}

export interface ProtectionSubmission {
  takeProfitOrders: OrderAck[];
  status: "active";
}

export async function protectFilledPosition(
  client: ExchangeClient,
  preview: TradePreview,
  tradeId: string
): Promise<ProtectionSubmission> {
  const closeSide = preview.signal.side === "long" ? "sell" : "buy";
  const tp1Price = preview.signal.takeProfits[0]?.price;
  const activePrice = preview.signal.trailingStop?.activationPrice ?? tp1Price;

  await client.setTradingStop({
    symbol: preview.signal.symbol,
    stopLoss: preview.signal.stopLoss,
    ...(activePrice !== undefined && preview.signal.trailingStop ? { activePrice } : {}),
    ...(preview.signal.trailingStop && activePrice !== undefined
      ? { trailingStop: preview.signal.trailingStop.distance.type === "absolute"
        ? preview.signal.trailingStop.distance.value
        : roundToStep(preview.entryPrice * preview.signal.trailingStop.distance.value / 100, preview.tickSize) }
      : {})
  });

  let allocated = 0;
  const takeProfitOrders: OrderAck[] = [];
  for (const [index, target] of preview.signal.takeProfits.entries()) {
    const isLast = index === preview.signal.takeProfits.length - 1;
    const rawQty = isLast ? preview.qty - allocated : preview.qty * target.sharePct / 100;
    const qty = roundToStep(rawQty, preview.qtyStep, "down");
    if (qty <= 0) continue;
    allocated += qty;
    try {
      const ack = await client.placeOrder({
        symbol: preview.signal.symbol,
        side: closeSide,
        type: "limit",
        price: target.price,
        qty,
        reduceOnly: true,
        orderLinkId: orderLinkId("tp", tradeId, String(index + 1))
      });
      takeProfitOrders.push(ack);
    } catch (tpErr) {
      console.warn(`TP${index + 1} placement failed on exchange for ${preview.signal.symbol}:`, tpErr);
    }
  }
  return { takeProfitOrders, status: "active" };
}

