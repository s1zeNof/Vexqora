import { queryKlines } from "./query-engine";
import {
  runEventDrivenBacktest,
  detectLiquiditySweep,
  type BacktestSignalCandidate,
  type BacktestResult
} from "@crypto-bot/trading";
import type { Kline } from "@crypto-bot/shared";

export interface RunBacktestCLIOptions {
  symbol?: string | undefined;
  timeframe?: string | undefined;
  initialBalance?: number | undefined;
}

export async function runDataLakeBacktest(options?: RunBacktestCLIOptions): Promise<BacktestResult> {
  const symbol = (options?.symbol ?? "BTCUSDT").toUpperCase();
  const timeframe = options?.timeframe ?? "15m";
  const initialBalance = options?.initialBalance ?? 1000;

  console.log("\n🧪 Vexqora Event-Driven Backtesting Engine (NautilusTrader / Qlib Style)");
  console.log("══════════════════════════════════════════════════════════════════");
  console.log(`📂 Loading historical ${timeframe} candles for ${symbol} from Data Lake...`);

  const records = await queryKlines({ symbol, timeframe });
  if (records.length === 0) {
    throw new Error(`No historical candles found for ${symbol} (${timeframe}) in Data Lake. Run 'npm run data:download -- --symbol=${symbol}' first.`);
  }

  console.log(`✅ Loaded ${records.length} candles (${new Date(records[0]!.timestamp).toISOString().slice(0, 10)} -> ${new Date(records[records.length - 1]!.timestamp).toISOString().slice(0, 10)}).`);

  // Convert HistoricalKlineRecord to Kline
  const klines: Kline[] = records.map((r) => ({
    time: r.timestamp,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume
  }));

  // Generate quantitative signals (Turtle Soup Liquidity Sweep + Trend Filter)
  const signals: BacktestSignalCandidate[] = [];
  for (let i = 25; i < klines.length - 1; i++) {
    const window = klines.slice(0, i + 1);
    const curr = klines[i]!;
    const sweep = detectLiquiditySweep(window, curr.close);

    if (sweep.isSweep) {
      if (sweep.type === "sweep_low_bullish") {
        const slDist = curr.close * 0.015;
        signals.push({
          time: curr.time,
          symbol,
          side: "long",
          entryPrice: curr.close,
          stopLoss: curr.close - slDist,
          tp1: curr.close + slDist * 1.8,
          tp2: curr.close + slDist * 2.6,
          tp3: curr.close + slDist * 3.5,
          reason: sweep.description
        });
      } else if (sweep.type === "sweep_high_bearish") {
        const slDist = curr.close * 0.015;
        signals.push({
          time: curr.time,
          symbol,
          side: "short",
          entryPrice: curr.close,
          stopLoss: curr.close + slDist,
          tp1: curr.close - slDist * 1.8,
          tp2: curr.close - slDist * 2.6,
          tp3: curr.close - slDist * 3.5,
          reason: sweep.description
        });
      }
    }
  }

  console.log(`⚡ Identified ${signals.length} valid quantitative entry signals across history.`);
  console.log(`⚙️ Running event simulation (Taker: 0.055%, Maker: 0.02%, Slippage: 0.03%, Trailing: 1.0%)...\n`);

  const result = runEventDrivenBacktest(klines, signals, {
    initialBalanceUsd: initialBalance,
    riskPerTradePct: 1.5,
    leverage: 5
  });

  // Display performance dashboard
  console.log("┌───────────────────────────┬──────────────────────────────────┐");
  console.log(`│ Initial Balance           │ $${result.initialBalance.toLocaleString().padEnd(32)} │`);
  console.log(`│ Final Balance             │ $${result.finalBalance.toLocaleString().padEnd(32)} │`);
  console.log(`│ Net PnL (USDT / %)        │ ${result.netPnlUsd >= 0 ? "+" : ""}$${result.netPnlUsd.toLocaleString()} (${result.netReturnPct >= 0 ? "+" : ""}${result.netReturnPct}%)${" ".repeat(Math.max(1, 20 - result.netPnlUsd.toString().length))} │`);
  console.log(`│ Total Trades Executed     │ ${result.totalTrades.toString().padEnd(32)} │`);
  console.log(`│ Win Rate                  │ ${result.winRatePct}% (${result.winningTrades}W / ${result.losingTrades}L)${" ".repeat(Math.max(1, 23 - result.winningTrades.toString().length))} │`);
  console.log(`│ Profit Factor             │ ${result.profitFactor.toString().padEnd(32)} │`);
  console.log(`│ Max Drawdown              │ ${result.maxDrawdownPct}%${" ".repeat(31)} │`);
  console.log(`│ Sharpe Ratio              │ ${result.sharpeRatio.toString().padEnd(32)} │`);
  console.log(`│ Sortino Ratio             │ ${result.sortinoRatio.toString().padEnd(32)} │`);
  console.log(`│ Total Fees & Funding Paid │ $${result.totalFeesPaidUsd.toLocaleString().padEnd(32)} │`);
  console.log(`│ Avg Trade Duration        │ ${result.avgTradeDurationMin} minutes${" ".repeat(Math.max(1, 24 - result.avgTradeDurationMin.toString().length))} │`);
  console.log("└───────────────────────────┴──────────────────────────────────┘\n");

  if (result.trades.length > 0) {
    console.log("📋 Last 5 Closed Trades:");
    for (const t of result.trades.slice(-5)) {
      const pnlStr = t.netPnlUsd >= 0 ? `+$${t.netPnlUsd}` : `-$${Math.abs(t.netPnlUsd)}`;
      console.log(`  • [${t.side.toUpperCase()}] Entry: ${t.entryPrice} -> Exit: ${t.exitPrice} | Net PnL: ${pnlStr} | Reason: ${t.exitReason.toUpperCase()}`);
    }
  }

  return result;
}

if (process.argv[1] && process.argv[1].endsWith("backtest-runner.ts")) {
  const symbolArg = process.argv.find((a) => a.startsWith("--symbol="))?.split("=")[1];
  const tfArg = process.argv.find((a) => a.startsWith("--timeframe="))?.split("=")[1];
  const initialArg = process.argv.find((a) => a.startsWith("--initial="))?.split("=")[1];

  runDataLakeBacktest({
    symbol: symbolArg,
    timeframe: tfArg,
    initialBalance: initialArg ? Number(initialArg) : 1000
  }).catch((err) => {
    console.error("Backtest Error:", err);
    process.exit(1);
  });
}
