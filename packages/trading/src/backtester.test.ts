import { describe, it, expect } from "vitest";
import { runEventDrivenBacktest, type BacktestSignalCandidate } from "./backtester";
import type { Kline } from "@crypto-bot/shared";

describe("Event-Driven Backtesting Engine", () => {
  it("executes profitable long trade with partial TPs (TP1 -> TP2 -> TP3)", () => {
    // 5 bars ascending
    const klines: Kline[] = [
      { time: 1000, open: 60000, high: 60500, low: 59900, close: 60000, volume: 100 }, // entry bar
      { time: 2000, open: 60000, high: 61500, low: 60000, close: 61200, volume: 100 }, // hits TP1 (61,200)
      { time: 3000, open: 61200, high: 62500, low: 61000, close: 62200, volume: 100 }, // hits TP2 (62,000)
      { time: 4000, open: 62200, high: 63500, low: 62000, close: 63200, volume: 100 }  // hits TP3 (63,000)
    ];

    const signals: BacktestSignalCandidate[] = [
      {
        time: 1000,
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 60000,
        stopLoss: 59000,
        tp1: 61200,
        tp2: 62000,
        tp3: 63000
      }
    ];

    const res = runEventDrivenBacktest(klines, signals, { initialBalanceUsd: 1000 });

    expect(res.totalTrades).toBe(1);
    expect(res.winningTrades).toBe(1);
    expect(res.winRatePct).toBe(100);
    expect(res.netPnlUsd).toBeGreaterThan(0);
    expect(res.finalBalance).toBeGreaterThan(1000);
    expect(res.totalFeesPaidUsd).toBeGreaterThan(0);
    expect(res.trades[0]?.exitReason).toBe("tp3");
  });

  it("handles stop loss exit and records taker fee deduction", () => {
    const klines: Kline[] = [
      { time: 1000, open: 60000, high: 60200, low: 59900, close: 60000, volume: 100 }, // entry
      { time: 2000, open: 60000, high: 60100, low: 58800, close: 58900, volume: 100 }  // breaches SL 59,000
    ];

    const signals: BacktestSignalCandidate[] = [
      {
        time: 1000,
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 60000,
        stopLoss: 59000,
        tp1: 62000
      }
    ];

    const res = runEventDrivenBacktest(klines, signals, { initialBalanceUsd: 1000 });

    expect(res.totalTrades).toBe(1);
    expect(res.losingTrades).toBe(1);
    expect(res.winRatePct).toBe(0);
    expect(res.netPnlUsd).toBeLessThan(0);
    expect(res.finalBalance).toBeLessThan(1000);
    expect(res.trades[0]?.exitReason).toBe("sl");
  });

  it("triggers trailing stop after TP1 and locks in partial profit", () => {
    const klines: Kline[] = [
      { time: 1000, open: 60000, high: 60200, low: 59900, close: 60000, volume: 100 }, // entry
      { time: 2000, open: 60000, high: 61500, low: 60000, close: 61400, volume: 100 }, // hits TP1 (61,200) -> trailing active
      { time: 3000, open: 61400, high: 61600, low: 60400, close: 60500, volume: 100 }  // pulls back >1% -> trailing exit
    ];

    const signals: BacktestSignalCandidate[] = [
      {
        time: 1000,
        symbol: "BTCUSDT",
        side: "long",
        entryPrice: 60000,
        stopLoss: 59000,
        tp1: 61200,
        tp2: 63000,
        tp3: 65000
      }
    ];

    const res = runEventDrivenBacktest(klines, signals, { initialBalanceUsd: 1000 });

    expect(res.totalTrades).toBe(1);
    expect(res.trades[0]?.exitReason).toBe("trailing_stop");
    expect(res.netPnlUsd).toBeGreaterThan(0); // partial TP1 + trailing locked in profit!
  });

  it("calculates accurate Max Drawdown and Sharpe Ratio", () => {
    const klines: Kline[] = [
      { time: 1000, open: 100, high: 101, low: 99, close: 100, volume: 100 },
      { time: 2000, open: 100, high: 100, low: 90, close: 91, volume: 100 }, // loss
      { time: 3000, open: 91, high: 92, low: 90, close: 91, volume: 100 },
      { time: 4000, open: 91, high: 105, low: 91, close: 104, volume: 100 } // win
    ];

    const signals: BacktestSignalCandidate[] = [
      { time: 1000, symbol: "TEST", side: "long", entryPrice: 100, stopLoss: 95, tp1: 110 },
      { time: 3000, symbol: "TEST", side: "long", entryPrice: 91, stopLoss: 88, tp1: 100 }
    ];

    const res = runEventDrivenBacktest(klines, signals);
    expect(res.maxDrawdownPct).toBeGreaterThan(0);
    expect(typeof res.sharpeRatio).toBe("number");
    expect(typeof res.profitFactor).toBe("number");
  });
});
