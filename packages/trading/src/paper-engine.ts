import { roundToStep } from "./risk";

export interface PaperTrailingStopState {
  distance?: {
    type: "percent" | "absolute";
    value: number;
  } | undefined;
  activationPrice?: number | undefined;
  highestPrice?: number | undefined;
  lowestPrice?: number | undefined;
  activated?: boolean | undefined;
  controlMode?: "auto" | "manual" | undefined;
  initialQty?: number | undefined;
}

export interface PaperTradeSnapshot {
  id: string;
  symbol: string;
  side: "long" | "short";
  entry_avg: number;
  qty: number;
  leverage: number;
  sl: number | null;
  trailing_stop: PaperTrailingStopState | null;
  realized_pnl: number;
  status: "active" | "entry_open" | "closed" | "cancelled" | "failed";
}

export interface PaperTargetSnapshot {
  id: string;
  idx: number;
  price: number;
  share_pct: number;
  status: "open" | "filled" | "cancelled";
}

export type PaperTradeAction =
  | {
      type: "TP_FILLED";
      targetId: string;
      targetIdx: number;
      targetPrice: number;
      closedQty: number;
      realizedPnl: number;
      remainingQty: number;
      isFullyClosed: boolean;
      updatedTrailingStop: PaperTrailingStopState;
      reason: string;
    }
  | {
      type: "TRAILING_STOP_TRIGGERED";
      triggerPrice: number;
      highestPrice?: number;
      lowestPrice?: number;
      closedQty: number;
      realizedPnl: number;
      updatedTrailingStop: PaperTrailingStopState;
      reason: string;
    }
  | {
      type: "STOP_LOSS_TRIGGERED";
      slPrice: number;
      closedQty: number;
      realizedPnl: number;
      reason: string;
    }
  | {
      type: "TRAILING_PEAK_UPDATED";
      updatedTrailingStop: PaperTrailingStopState;
      reason: string;
    }
  | {
      type: "MANUAL_HOLD";
      reason: string;
    }
  | {
      type: "ENTRY_FILLED";
      fillPrice: number;
      reason: string;
    };

export interface PaperEvaluationResult {
  actions: PaperTradeAction[];
  updatedTrade: {
    qty: number;
    realized_pnl: number;
    status: "active" | "closed" | "entry_open";
    trailing_stop: PaperTrailingStopState | null;
    closed_at?: string;
    exit?: {
      reason: "take_profit" | "stop_loss" | "trailing_stop";
      price: number;
      details: Record<string, unknown>;
    };
  };
  updatedTargets: Array<{
    id: string;
    status: "filled" | "cancelled" | "open";
    filled_at?: string;
  }>;
  totalRealizedPnlDelta: number;
}

/**
 * Pure evaluation function for paper trading positions against current market price.
 * Follows deterministic matching:
 * 1. Checks Manual vs Autopilot mode. In Manual mode, no automated closures occur.
 * 2. Checks Stop Loss breach.
 * 3. Checks Take Profit levels (TP1, TP2, TP3) with partial position sizing (e.g. 40%, 30%, 30%).
 * 4. Updates dynamic trailing peak and triggers trailing exit upon 1% rollback from peak after TP1.
 */
export function evaluatePaperTrade(
  trade: PaperTradeSnapshot,
  targets: PaperTargetSnapshot[],
  currentPrice: number,
  qtyStep = 0
): PaperEvaluationResult {
  // If trade is not active or has 0 qty, return no-op
  if (trade.status !== "active" && trade.status !== "entry_open") {
    return {
      actions: [],
      updatedTrade: {
        qty: trade.qty,
        realized_pnl: trade.realized_pnl,
        status: trade.status === "closed" ? "closed" : "active",
        trailing_stop: trade.trailing_stop
      },
      updatedTargets: [],
      totalRealizedPnlDelta: 0
    };
  }

  const isLong = trade.side === "long";
  const controlMode = trade.trailing_stop?.controlMode ?? "auto";
  const initialQty = trade.trailing_stop?.initialQty ?? trade.qty;

  let trailingState: PaperTrailingStopState = {
    distance: { type: "percent", value: 2.0 },
    ...trade.trailing_stop,
    initialQty,
    controlMode
  };

  // If in Manual control mode, human trader is in full control.
  // We can track peak prices for convenience, but NEVER trigger auto-closes.
  if (controlMode === "manual") {
    let peakUpdated = false;
    if (isLong && currentPrice > (trailingState.highestPrice ?? trade.entry_avg)) {
      trailingState = { ...trailingState, highestPrice: currentPrice };
      peakUpdated = true;
    } else if (!isLong && currentPrice < (trailingState.lowestPrice ?? trade.entry_avg)) {
      trailingState = { ...trailingState, lowestPrice: currentPrice };
      peakUpdated = true;
    }

    return {
      actions: peakUpdated
        ? [{ type: "TRAILING_PEAK_UPDATED", updatedTrailingStop: trailingState, reason: "Manual mode: peak tracked without execution" }]
        : [{ type: "MANUAL_HOLD", reason: "Manual mode: automated execution paused" }],
      updatedTrade: {
        qty: trade.qty,
        realized_pnl: trade.realized_pnl,
        status: "active",
        trailing_stop: trailingState
      },
      updatedTargets: [],
      totalRealizedPnlDelta: 0
    };
  }

  const actions: PaperTradeAction[] = [];
  const updatedTargets: Array<{ id: string; status: "filled" | "cancelled" | "open"; filled_at?: string }> = [];
  let remainingQty = trade.qty;
  let realizedPnlDelta = 0;
  const nowIso = new Date().toISOString();

  // If trade is resting in entry_open, check if limit price has been touched
  if (trade.status === "entry_open") {
    const isLimitFilled = isLong
      ? currentPrice <= trade.entry_avg
      : currentPrice >= trade.entry_avg;

    if (!isLimitFilled) {
      return {
        actions: [],
        updatedTrade: {
          qty: trade.qty,
          realized_pnl: trade.realized_pnl,
          status: "entry_open",
          trailing_stop: trailingState
        },
        updatedTargets: [],
        totalRealizedPnlDelta: 0
      };
    }

    actions.push({
      type: "ENTRY_FILLED",
      fillPrice: trade.entry_avg,
      reason: `Limit order filled at ${trade.entry_avg}`
    });
  }

  // 1. Check Stop Loss
  if (trade.sl !== null) {
    // Sanity check: Stop Loss must never be corrupted, inverted, or further than 10% / liquidation threshold
    const maxAllowedDist = trade.entry_avg * Math.min(0.10, 1 / (trade.leverage || 5));
    const isSlInvalid = isLong
      ? trade.sl >= trade.entry_avg || (trade.entry_avg - trade.sl) > maxAllowedDist
      : trade.sl <= trade.entry_avg || (trade.sl - trade.entry_avg) > maxAllowedDist;
    const safeSl = isSlInvalid
      ? (isLong ? trade.entry_avg * 0.975 : trade.entry_avg * 1.025)
      : trade.sl;

    const isSlHit = isLong ? currentPrice <= safeSl : currentPrice >= safeSl;
    if (isSlHit) {
      // In realistic exchange matching, Stop Loss conditional orders trigger immediately near safeSl.
      // Exit price allows normal market slippage, while strictly capping extreme anomalous spikes from wiping the user.
      const slDistance = Math.abs(trade.entry_avg - safeSl);
      const maxAllowedDeviation = Math.max(slDistance * 1.5, safeSl * 0.03);
      const minExitPrice = safeSl - maxAllowedDeviation;
      const maxExitPrice = safeSl + maxAllowedDeviation;
      const exitPrice = isLong
        ? Math.max(currentPrice, minExitPrice)
        : Math.min(currentPrice, maxExitPrice);

      const rawPnl = (exitPrice - trade.entry_avg) * remainingQty * (isLong ? 1 : -1);

      // Isolated margin constraint: Loss can never exceed the allocated position margin
      const positionMargin = trade.leverage > 0 && trade.entry_avg > 0
        ? (trade.entry_avg * remainingQty) / trade.leverage
        : remainingQty * trade.entry_avg;
      const pnl = Math.max(rawPnl, -positionMargin);

      actions.push({
        type: "STOP_LOSS_TRIGGERED",
        slPrice: safeSl,
        closedQty: remainingQty,
        realizedPnl: pnl,
        reason: `Stop loss breached at ${exitPrice} (SL level: ${safeSl})`
      });

      // All open targets cancelled
      for (const t of targets) {
        if (t.status === "open") {
          updatedTargets.push({ id: t.id, status: "cancelled" });
        }
      }

      return {
        actions,
        updatedTrade: {
          qty: 0,
          realized_pnl: trade.realized_pnl + pnl,
          status: "closed",
          trailing_stop: trailingState,
          closed_at: nowIso,
          exit: {
            reason: "stop_loss",
            price: exitPrice,
            details: { configuredStopLoss: trade.sl, closedQty: remainingQty }
          }
        },
        updatedTargets,
        totalRealizedPnlDelta: pnl
      };
    }
  }

  // 2. Check Take Profit targets (ordered by idx: 1, 2, 3...)
  const openTargets = targets
    .filter((t) => t.status === "open")
    .sort((a, b) => a.idx - b.idx);

  for (let i = 0; i < openTargets.length; i++) {
    const target = openTargets[i]!;
    const isTpHit = isLong ? currentPrice >= target.price : currentPrice <= target.price;

    if (isTpHit && remainingQty > 0) {
      const isLastTarget = i === openTargets.length - 1;
      const rawTargetQty = initialQty * (target.share_pct / 100);
      const steppedQty = qtyStep > 0 ? roundToStep(rawTargetQty, qtyStep, "down") : rawTargetQty;
      const closeQty = isLastTarget || steppedQty >= remainingQty || steppedQty <= 0
        ? remainingQty
        : steppedQty;

      const pnl = (target.price - trade.entry_avg) * closeQty * (isLong ? 1 : -1);
      remainingQty -= closeQty;
      realizedPnlDelta += pnl;

      // If TP1 hit: activate dynamic trailing stop
      if (target.idx === 1) {
        trailingState = {
          ...trailingState,
          activated: true,
          ...(isLong ? { highestPrice: Math.max(trailingState.highestPrice ?? target.price, currentPrice) } : {}),
          ...(!isLong ? { lowestPrice: Math.min(trailingState.lowestPrice ?? target.price, currentPrice) } : {})
        };
      }

      const isFullyClosed = remainingQty <= 0;
      updatedTargets.push({
        id: target.id,
        status: "filled",
        filled_at: nowIso
      });

      actions.push({
        type: "TP_FILLED",
        targetId: target.id,
        targetIdx: target.idx,
        targetPrice: target.price,
        closedQty: closeQty,
        realizedPnl: pnl,
        remainingQty,
        isFullyClosed,
        updatedTrailingStop: trailingState,
        reason: `TP${target.idx} reached at ${target.price} (${target.share_pct}% share)`
      });

      if (isFullyClosed) {
        // Position fully closed via TPs
        return {
          actions,
          updatedTrade: {
            qty: 0,
            realized_pnl: trade.realized_pnl + realizedPnlDelta,
            status: "closed",
            trailing_stop: trailingState,
            closed_at: nowIso,
            exit: {
              reason: "take_profit",
              price: target.price,
              details: { targetIdx: target.idx, targetPrice: target.price, closedQty: closeQty }
            }
          },
          updatedTargets,
          totalRealizedPnlDelta: realizedPnlDelta
        };
      }
    }
  }

  // 3. Dynamic Trailing Stop check (if activated)
  // Activated either after TP1 or explicitly set
  const isTrailingActive = trailingState.activated === true ||
    (trailingState.activationPrice !== undefined &&
      (isLong ? currentPrice >= trailingState.activationPrice : currentPrice <= trailingState.activationPrice));

  if (isTrailingActive && remainingQty > 0) {
    const trailPct = trailingState.distance?.type === "percent"
      ? trailingState.distance.value
      : (trailingState.distance?.value ? (trailingState.distance.value / trade.entry_avg) * 100 : 2.0);

    if (isLong) {
      const currentPeak = Math.max(trailingState.highestPrice ?? currentPrice, currentPrice);
      trailingState = { ...trailingState, activated: true, highestPrice: currentPeak };

      const triggerPrice = currentPeak * (1 - trailPct / 100);

      if (currentPrice <= triggerPrice) {
        // Trailing stop trigger: market close remaining quantity
        const rawPnl = (currentPrice - trade.entry_avg) * remainingQty;
        const positionMargin = trade.leverage > 0 && trade.entry_avg > 0
          ? (trade.entry_avg * remainingQty) / trade.leverage
          : remainingQty * trade.entry_avg;
        const pnl = Math.max(rawPnl, -positionMargin);
        realizedPnlDelta += pnl;

        actions.push({
          type: "TRAILING_STOP_TRIGGERED",
          triggerPrice,
          highestPrice: currentPeak,
          closedQty: remainingQty,
          realizedPnl: pnl,
          updatedTrailingStop: trailingState,
          reason: `Trailing stop triggered at ${currentPrice} (-${trailPct}% from peak ${currentPeak})`
        });

        // Cancel remaining open targets
        for (const t of targets) {
          if (t.status === "open" && !updatedTargets.some((ut) => ut.id === t.id)) {
            updatedTargets.push({ id: t.id, status: "cancelled" });
          }
        }

        return {
          actions,
          updatedTrade: {
            qty: 0,
            realized_pnl: trade.realized_pnl + realizedPnlDelta,
            status: "closed",
            trailing_stop: trailingState,
            closed_at: nowIso,
            exit: {
              reason: "trailing_stop",
              price: currentPrice,
              details: { triggerPrice, peakPrice: currentPeak, trailPct, closedQty: remainingQty }
            }
          },
          updatedTargets,
          totalRealizedPnlDelta: realizedPnlDelta
        };
      }
    } else {
      // Short trailing stop
      const currentTrough = Math.min(trailingState.lowestPrice ?? currentPrice, currentPrice);
      trailingState = { ...trailingState, activated: true, lowestPrice: currentTrough };

      const triggerPrice = currentTrough * (1 + trailPct / 100);

      if (currentPrice >= triggerPrice) {
        // Trailing stop trigger: market close remaining quantity
        const rawPnl = (trade.entry_avg - currentPrice) * remainingQty;
        const positionMargin = trade.leverage > 0 && trade.entry_avg > 0
          ? (trade.entry_avg * remainingQty) / trade.leverage
          : remainingQty * trade.entry_avg;
        const pnl = Math.max(rawPnl, -positionMargin);
        realizedPnlDelta += pnl;

        actions.push({
          type: "TRAILING_STOP_TRIGGERED",
          triggerPrice,
          lowestPrice: currentTrough,
          closedQty: remainingQty,
          realizedPnl: pnl,
          updatedTrailingStop: trailingState,
          reason: `Trailing stop triggered at ${currentPrice} (+${trailPct}% from trough ${currentTrough})`
        });

        for (const t of targets) {
          if (t.status === "open" && !updatedTargets.some((ut) => ut.id === t.id)) {
            updatedTargets.push({ id: t.id, status: "cancelled" });
          }
        }

        return {
          actions,
          updatedTrade: {
            qty: 0,
            realized_pnl: trade.realized_pnl + realizedPnlDelta,
            status: "closed",
            trailing_stop: trailingState,
            closed_at: nowIso,
            exit: {
              reason: "trailing_stop",
              price: currentPrice,
              details: { triggerPrice, troughPrice: currentTrough, trailPct, closedQty: remainingQty }
            }
          },
          updatedTargets,
          totalRealizedPnlDelta: realizedPnlDelta
        };
      }
    }
  }

  // If peak was updated but no exit triggered
  if (actions.length === 0 && trailingState.highestPrice !== trade.trailing_stop?.highestPrice) {
    actions.push({
      type: "TRAILING_PEAK_UPDATED",
      updatedTrailingStop: trailingState,
      reason: `Peak price updated to ${trailingState.highestPrice}`
    });
  }

  return {
    actions,
    updatedTrade: {
      qty: remainingQty,
      realized_pnl: trade.realized_pnl + realizedPnlDelta,
      status: remainingQty <= 0 ? "closed" : "active",
      trailing_stop: trailingState,
      ...(remainingQty <= 0 ? { closed_at: nowIso } : {})
    },
    updatedTargets,
    totalRealizedPnlDelta: realizedPnlDelta
  };
}
