import type { Kline } from "@crypto-bot/shared";

export interface BacktestOptions {
  initialBalanceUsd?: number; // default $1,000
  riskPerTradePct?: number; // default 1.5%
  leverage?: number; // default 5x
  takerFeeRate?: number; // default 0.00055 (0.055% Bybit)
  makerFeeRate?: number; // default 0.00020 (0.020% Bybit)
  slippagePct?: number; // default 0.0003 (0.03%)
  fundingRate8h?: number; // default 0.0001 (0.01% every 8h)
  trailingStopPct?: number; // default 0.01 (1.0% pullback from peak)
}

export interface BacktestSignalCandidate {
  time: number;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2?: number;
  tp3?: number;
  reason?: string;
}

export interface BacktestTrade {
  id: string;
  symbol: string;
  side: "long" | "short";
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  positionSizeUsd: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  netReturnPct: number;
  totalFeesUsd: number;
  exitReason: "sl" | "tp1" | "tp2" | "tp3" | "trailing_stop" | "horizon_expired";
  peakProfitPct: number;
}

export interface BacktestResult {
  symbol: string;
  initialBalance: number;
  finalBalance: number;
  netPnlUsd: number;
  netReturnPct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  totalFeesPaidUsd: number;
  avgTradeDurationMin: number;
  trades: BacktestTrade[];
}

/**
 * Event-Driven Backtesting Engine inspired by NautilusTrader.
 * Simulates realistic crypto perpetual order execution, partial TP scaling (40/30/30),
 * dynamic trailing stop tracking, taker/maker fee modeling, and funding rate drag.
 */
export function runEventDrivenBacktest(
  klines: Kline[],
  signals: BacktestSignalCandidate[],
  options?: BacktestOptions
): BacktestResult {
  const initialBalance = options?.initialBalanceUsd ?? 1000;
  const riskPct = (options?.riskPerTradePct ?? 1.5) / 100;
  const leverage = options?.leverage ?? 5;
  const takerFeeRate = options?.takerFeeRate ?? 0.00055;
  const makerFeeRate = options?.makerFeeRate ?? 0.00020;
  const slippagePct = options?.slippagePct ?? 0.0003;
  const fundingRate8h = options?.fundingRate8h ?? 0.0001;
  const trailingPullback = options?.trailingStopPct ?? 0.01;

  let balance = initialBalance;
  let peakBalance = initialBalance;
  let maxDrawdownUsd = 0;
  let totalFeesPaid = 0;
  const closedTrades: BacktestTrade[] = [];

  // Index signals by candle time
  const signalMap = new Map<number, BacktestSignalCandidate>();
  for (const s of signals) {
    signalMap.set(s.time, s);
  }

  // Active position state
  interface ActivePosition {
    signal: BacktestSignalCandidate;
    entryTime: number;
    effectiveEntry: number;
    remainingQtyRatio: number; // starts at 1.0
    initialPositionSizeUsd: number;
    realizedPnlUsd: number;
    feesUsd: number;
    tp1Hit: boolean;
    tp2Hit: boolean;
    peakPrice: number;
    trailingStopActive: boolean;
    trailingStopPrice: number;
    trailingActivationTime: number;
  }

  let currentPosition: ActivePosition | null = null;

  for (let i = 0; i < klines.length; i++) {
    const bar = klines[i]!;

    // 1. Process active position against current bar's price action
    if (currentPosition) {
      const pos = currentPosition;
      const isLong = pos.signal.side === "long";
      const h = bar.high;
      const l = bar.low;

      // Update funding fee (accrued per 8h elapsed)
      const hoursHeld = (bar.time - pos.entryTime) / (3600 * 1000);
      if (hoursHeld >= 8) {
        const intervals = Math.floor(hoursHeld / 8);
        const fundingFee = pos.initialPositionSizeUsd * fundingRate8h * (intervals / 8);
        pos.feesUsd += fundingFee;
      }

      // Check Stop Loss first (conservative risk handling)
      const slPrice = pos.signal.stopLoss;
      const slTriggered = isLong ? l <= slPrice : h >= slPrice;

      if (slTriggered) {
        // Exit remaining position at SL + slippage with taker fee
        const effectiveExit = isLong ? slPrice * (1 - slippagePct) : slPrice * (1 + slippagePct);
        const remainingSizeUsd = pos.initialPositionSizeUsd * pos.remainingQtyRatio;
        const exitFee = remainingSizeUsd * takerFeeRate;
        pos.feesUsd += exitFee;

        const pnl = isLong
          ? remainingSizeUsd * ((effectiveExit - pos.effectiveEntry) / pos.effectiveEntry)
          : remainingSizeUsd * ((pos.effectiveEntry - effectiveExit) / pos.effectiveEntry);

        pos.realizedPnlUsd += pnl;
        const netPnl = pos.realizedPnlUsd - pos.feesUsd;
        balance += netPnl;
        totalFeesPaid += pos.feesUsd;

        closedTrades.push({
          id: `trade-${pos.entryTime}`,
          symbol: pos.signal.symbol,
          side: pos.signal.side,
          entryTime: pos.entryTime,
          entryPrice: pos.effectiveEntry,
          exitTime: bar.time,
          exitPrice: effectiveExit,
          positionSizeUsd: pos.initialPositionSizeUsd,
          grossPnlUsd: Number(pos.realizedPnlUsd.toFixed(2)),
          netPnlUsd: Number(netPnl.toFixed(2)),
          netReturnPct: Number(((netPnl / pos.initialPositionSizeUsd) * 100).toFixed(2)),
          totalFeesUsd: Number(pos.feesUsd.toFixed(2)),
          exitReason: "sl",
          peakProfitPct: Number((((pos.peakPrice - pos.effectiveEntry) / pos.effectiveEntry) * 100).toFixed(2))
        });

        currentPosition = null;
      } else {
        // 1. Check Take Profits first (Limit Maker orders resting on exchange book)
        // TP1:
        if (!pos.tp1Hit && (isLong ? h >= pos.signal.tp1 : l <= pos.signal.tp1)) {
          const tp1Exit = pos.signal.tp1;
          const portionSizeUsd = pos.initialPositionSizeUsd * 0.40;
          const fee = portionSizeUsd * makerFeeRate; // Limit maker fill
          pos.feesUsd += fee;
          const pnl = isLong
            ? portionSizeUsd * ((tp1Exit - pos.effectiveEntry) / pos.effectiveEntry)
            : portionSizeUsd * ((pos.effectiveEntry - tp1Exit) / pos.effectiveEntry);
          pos.realizedPnlUsd += pnl;
          pos.remainingQtyRatio -= 0.40;
          pos.tp1Hit = true;
          // Activate trailing stop upon TP1
          pos.trailingStopActive = true;
          pos.trailingActivationTime = bar.time;
          pos.trailingStopPrice = isLong ? tp1Exit * (1 - trailingPullback) : tp1Exit * (1 + trailingPullback);
        }

        // TP2:
        const tp2Price = pos.signal.tp2;
        if (pos.tp1Hit && !pos.tp2Hit && tp2Price && (isLong ? h >= tp2Price : l <= tp2Price)) {
          const portionSizeUsd = pos.initialPositionSizeUsd * 0.30;
          const fee = portionSizeUsd * makerFeeRate;
          pos.feesUsd += fee;
          const pnl = isLong
            ? portionSizeUsd * ((tp2Price - pos.effectiveEntry) / pos.effectiveEntry)
            : portionSizeUsd * ((pos.effectiveEntry - tp2Price) / pos.effectiveEntry);
          pos.realizedPnlUsd += pnl;
          pos.remainingQtyRatio -= 0.30;
          pos.tp2Hit = true;
        }

        // TP3 (final close):
        const tp3Price = pos.signal.tp3;
        if (pos.tp2Hit && tp3Price && (isLong ? h >= tp3Price : l <= tp3Price)) {
          const portionSizeUsd = pos.initialPositionSizeUsd * pos.remainingQtyRatio;
          const fee = portionSizeUsd * makerFeeRate;
          pos.feesUsd += fee;
          const pnl = isLong
            ? portionSizeUsd * ((tp3Price - pos.effectiveEntry) / pos.effectiveEntry)
            : portionSizeUsd * ((pos.effectiveEntry - tp3Price) / pos.effectiveEntry);
          pos.realizedPnlUsd += pnl;
          const netPnl = pos.realizedPnlUsd - pos.feesUsd;
          balance += netPnl;
          totalFeesPaid += pos.feesUsd;

          closedTrades.push({
            id: `trade-${pos.entryTime}`,
            symbol: pos.signal.symbol,
            side: pos.signal.side,
            entryTime: pos.entryTime,
            entryPrice: pos.effectiveEntry,
            exitTime: bar.time,
            exitPrice: tp3Price,
            positionSizeUsd: pos.initialPositionSizeUsd,
            grossPnlUsd: Number(pos.realizedPnlUsd.toFixed(2)),
            netPnlUsd: Number(netPnl.toFixed(2)),
            netReturnPct: Number(((netPnl / pos.initialPositionSizeUsd) * 100).toFixed(2)),
            totalFeesUsd: Number(pos.feesUsd.toFixed(2)),
            exitReason: "tp3",
            peakProfitPct: Number((((pos.peakPrice - pos.effectiveEntry) / pos.effectiveEntry) * 100).toFixed(2))
          });

          currentPosition = null;
        }

        // 2. If position is still open: track peak and evaluate Trailing Stop pullback
        if (currentPosition) {
          let trailingTriggered = false;

          if (pos.trailingStopActive && bar.time > pos.trailingActivationTime) {
            if (isLong) {
              if (l <= pos.trailingStopPrice) {
                trailingTriggered = true;
              } else if (h > pos.peakPrice) {
                pos.peakPrice = h;
                pos.trailingStopPrice = Math.max(pos.trailingStopPrice, h * (1 - trailingPullback));
                if (bar.close <= pos.trailingStopPrice) {
                  trailingTriggered = true;
                }
              }
            } else {
              if (h >= pos.trailingStopPrice) {
                trailingTriggered = true;
              } else if (l < pos.peakPrice) {
                pos.peakPrice = l;
                pos.trailingStopPrice = Math.min(pos.trailingStopPrice, l * (1 + trailingPullback));
                if (bar.close >= pos.trailingStopPrice) {
                  trailingTriggered = true;
                }
              }
            }
          } else {
            // Trailing stop not yet active or just activated on this candle: update peak price
            if (isLong && h > pos.peakPrice) {
              pos.peakPrice = h;
              if (pos.trailingStopActive) {
                pos.trailingStopPrice = Math.max(pos.trailingStopPrice, h * (1 - trailingPullback));
              }
            } else if (!isLong && l < pos.peakPrice) {
              pos.peakPrice = l;
              if (pos.trailingStopActive) {
                pos.trailingStopPrice = Math.min(pos.trailingStopPrice, l * (1 + trailingPullback));
              }
            }
          }

          if (trailingTriggered) {
            const effectiveExit = pos.trailingStopPrice;
            const remainingSizeUsd = pos.initialPositionSizeUsd * pos.remainingQtyRatio;
            const exitFee = remainingSizeUsd * takerFeeRate;
            pos.feesUsd += exitFee;

            const pnl = isLong
              ? remainingSizeUsd * ((effectiveExit - pos.effectiveEntry) / pos.effectiveEntry)
              : remainingSizeUsd * ((pos.effectiveEntry - effectiveExit) / pos.effectiveEntry);

            pos.realizedPnlUsd += pnl;
            const netPnl = pos.realizedPnlUsd - pos.feesUsd;
            balance += netPnl;
            totalFeesPaid += pos.feesUsd;

            closedTrades.push({
              id: `trade-${pos.entryTime}`,
              symbol: pos.signal.symbol,
              side: pos.signal.side,
              entryTime: pos.entryTime,
              entryPrice: pos.effectiveEntry,
              exitTime: bar.time,
              exitPrice: effectiveExit,
              positionSizeUsd: pos.initialPositionSizeUsd,
              grossPnlUsd: Number(pos.realizedPnlUsd.toFixed(2)),
              netPnlUsd: Number(netPnl.toFixed(2)),
              netReturnPct: Number(((netPnl / pos.initialPositionSizeUsd) * 100).toFixed(2)),
              totalFeesUsd: Number(pos.feesUsd.toFixed(2)),
              exitReason: "trailing_stop",
              peakProfitPct: Number((((pos.peakPrice - pos.effectiveEntry) / pos.effectiveEntry) * 100).toFixed(2))
            });

            currentPosition = null;
          }
        }
      }
    }

    // Update equity drawdown
    if (balance > peakBalance) {
      peakBalance = balance;
    } else {
      const dd = peakBalance - balance;
      if (dd > maxDrawdownUsd) {
        maxDrawdownUsd = dd;
      }
    }

    // 2. Check for new trade signal entry on this candle (if no active position)
    if (!currentPosition && signalMap.has(bar.time)) {
      const sig = signalMap.get(bar.time)!;
      const isLong = sig.side === "long";
      const effectiveEntry = isLong ? sig.entryPrice * (1 + slippagePct) : sig.entryPrice * (1 - slippagePct);
      const riskDist = Math.abs(effectiveEntry - sig.stopLoss);

      if (riskDist > 0 && effectiveEntry > 0) {
        const dollarRisk = balance * riskPct;
        const positionSizeUsd = Math.min((dollarRisk / (riskDist / effectiveEntry)), balance * leverage);
        const entryFee = positionSizeUsd * takerFeeRate;

        currentPosition = {
          signal: sig,
          entryTime: bar.time,
          effectiveEntry,
          remainingQtyRatio: 1.0,
          initialPositionSizeUsd: positionSizeUsd,
          realizedPnlUsd: 0,
          feesUsd: entryFee,
          tp1Hit: false,
          tp2Hit: false,
          peakPrice: effectiveEntry,
          trailingStopActive: false,
          trailingStopPrice: sig.stopLoss,
          trailingActivationTime: 0
        };
      }
    }
  }

  // 3. Final performance calculations
  const totalTrades = closedTrades.length;
  const winningTrades = closedTrades.filter((t) => t.netPnlUsd > 0).length;
  const losingTrades = closedTrades.filter((t) => t.netPnlUsd <= 0).length;
  const winRatePct = totalTrades > 0 ? Number(((winningTrades / totalTrades) * 100).toFixed(1)) : 0;

  const grossProfit = closedTrades.filter((t) => t.grossPnlUsd > 0).reduce((sum, t) => sum + t.grossPnlUsd, 0);
  const grossLoss = Math.abs(closedTrades.filter((t) => t.grossPnlUsd < 0).reduce((sum, t) => sum + t.grossPnlUsd, 0));
  const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : (grossProfit > 0 ? 99.0 : 1.0);

  const netPnlUsd = Number((balance - initialBalance).toFixed(2));
  const netReturnPct = Number(((netPnlUsd / initialBalance) * 100).toFixed(2));
  const maxDrawdownPct = peakBalance > 0 ? Number(((maxDrawdownUsd / peakBalance) * 100).toFixed(2)) : 0;

  // Sharpe and Sortino ratio (annualized assuming 15m intervals)
  const returns = closedTrades.map((t) => t.netReturnPct / 100);
  const meanReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1 ? returns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / (returns.length - 1) : 1e-4;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? Number(((meanReturn / stdDev) * Math.sqrt(365 * 24)).toFixed(2)) : 0;

  const downReturns = returns.filter((r) => r < 0);
  const downVariance = downReturns.length > 1 ? downReturns.reduce((a, b) => a + Math.pow(b, 2), 0) / downReturns.length : 1e-4;
  const downDev = Math.sqrt(downVariance);
  const sortinoRatio = downDev > 0 ? Number(((meanReturn / downDev) * Math.sqrt(365 * 24)).toFixed(2)) : 0;

  const totalDurationMin = closedTrades.reduce((sum, t) => sum + ((t.exitTime - t.entryTime) / (60 * 1000)), 0);
  const avgTradeDurationMin = totalTrades > 0 ? Math.round(totalDurationMin / totalTrades) : 0;

  return {
    symbol: signals[0]?.symbol ?? "UNKNOWN",
    initialBalance,
    finalBalance: Number(balance.toFixed(2)),
    netPnlUsd,
    netReturnPct,
    totalTrades,
    winningTrades,
    losingTrades,
    winRatePct,
    profitFactor,
    maxDrawdownPct,
    sharpeRatio,
    sortinoRatio,
    totalFeesPaidUsd: Number(totalFeesPaid.toFixed(2)),
    avgTradeDurationMin,
    trades: closedTrades
  };
}
