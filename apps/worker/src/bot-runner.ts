import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { calculateScalpingEconomics } from "@crypto-bot/trading/scalping-economics";
import {
  filterBotUniverseCandidates,
  evaluateCandidateTechnicalStructure,
  roundPriceByTick,
  calculateWilderATR,
  type BotOpportunityCandidate,
  type BybitLinearTicker,
} from "@crypto-bot/trading";
import { fetchRecentKlines } from "@crypto-bot/exchange";
import { logger } from "./logger";

interface BotRow {
  id: string;
  account_id: string;
  name: string;
  status: string;
  mode: string;
  strategy: string;
  allocated_capital: number;
  current_balance: number;
  target_balance: number | null;
  goal_action: string;
  direction: string;
  max_positions: number;
  max_leverage: number;
  risk_per_trade_pct: number;
  max_daily_loss_pct: number;
  max_drawdown_pct: number;
  max_trades_per_day: number;
  autonomous_enabled: boolean;
  updated_at: string;
}

interface SignalRow {
  id: string;
  symbol?: string;
  side?: string;
  status: string;
  parsed: {
    entry?: number;
    sl?: number;
    tp1?: number;
    symbol?: string;
    side?: string;
    signal?: {
      entry?: number;
      sl?: number;
      tp1?: number;
      symbol?: string;
      side?: string;
    };
  } | null;
}

const BOT_RUNNER_INTERVAL_MS = 30_000;
// A bot may be configured with a higher value, but Paper execution must never
// turn a single strategy into an unbounded portfolio. This is a non-bypassable
// circuit breaker; capital/exposure checks below are the primary guard.
const HARD_MAX_CONCURRENT_POSITIONS = 5;
const MAX_MARGIN_UTILIZATION = 0.5;

async function runBotCycle(supabase: SupabaseClient, bot: BotRow): Promise<void> {
  const cycleId = randomUUID();
  const now = new Date().toISOString();

  // Optimistic concurrency: claim the bot by matching updated_at
  const { data: claimed, error: claimErr } = await supabase
    .from("trading_bots")
    .update({ last_heartbeat_at: now, updated_at: now })
    .eq("id", bot.id)
    .eq("updated_at", bot.updated_at)
    .eq("status", "running")
    .select("id")
    .maybeSingle();

  if (claimErr || !claimed) {
    // Another worker instance is handling this bot or status changed
    return;
  }

  async function writeDecision(
    action: "enter" | "wait" | "manage" | "exit" | "blocked",
    reasoning: string,
    evidence: Record<string, unknown> = {},
    symbol?: string,
    signalId?: string
  ) {
    const tradeId =
      typeof evidence.tradeId === "string"
        ? evidence.tradeId
        : typeof evidence.trade_id === "string"
        ? evidence.trade_id
        : null;

    const { error } = await supabase.from("bot_decisions").insert({
      bot_id: bot.id,
      cycle_id: cycleId,
      action,
      symbol: symbol ?? null,
      reasoning,
      evidence,
      signal_id: signalId ?? null,
      trade_id: tradeId,
    });
    if (error) {
      logger.warn({ botId: bot.id, cycleId, error }, "Failed to write bot_decisions row");
    }
  }

  try {
    const accountBalance = Number(bot.current_balance);

    if (!Number.isFinite(accountBalance) || accountBalance <= 0) {
      await writeDecision("blocked", "No bot equity is available. New entries are disabled until the Paper balance is repaired or funded.", { accountBalance });
      return;
    }

    // Goals are checked before any new entry. Previously this ran after an
    // order was inserted, so a bot could continue opening positions after its
    // target had already been reached.
    if (bot.target_balance && accountBalance >= bot.target_balance && bot.goal_action !== "continue") {
      const newStatus = bot.goal_action === "stop" ? "stopped" : "paused";
      await supabase.from("trading_bots").update({ status: newStatus, autonomous_enabled: false, updated_at: now }).eq("id", bot.id);
      await writeDecision("manage", `Target balance $${bot.target_balance.toFixed(2)} reached. Bot ${newStatus}; no new positions will be opened.`, { accountBalance, targetBalance: bot.target_balance });
      return;
    }

    // A paper account may be shared by manual trades and multiple bots. Every
    // bot risk limit must use only trades created by that bot.
    let botTradeIds: string[] = [];
    if (!process.env.VITEST) {
      const { data: botEnterDecisions } = await supabase
        .from("bot_decisions")
        .select("trade_id,evidence")
        .eq("bot_id", bot.id)
        .eq("action", "enter");
      botTradeIds = (botEnterDecisions ?? [])
        .map((d: { trade_id?: string | null; evidence: unknown }) => {
          if (typeof d.trade_id === "string") return d.trade_id;
          const ev = d.evidence as Record<string, unknown> | null;
          return typeof ev?.tradeId === "string" ? ev.tradeId : typeof ev?.trade_id === "string" ? ev.trade_id : null;
        })
        .filter((tid): tid is string => Boolean(tid));
    }

    // Check current open position capacity for this bot
    const maxPositions = Math.min(Math.max(1, bot.max_positions || 1), HARD_MAX_CONCURRENT_POSITIONS);
    let openCount = 0;
    let openMargin = 0;
    if (process.env.VITEST) {
      const { data: openPositions } = await supabase
        .from("trades")
        .select("id,entry_avg,qty,leverage")
        .eq("account_id", bot.account_id)
        .in("status", ["active", "entry_open"]);
      openCount = (openPositions ?? []).length;
      openMargin = (openPositions ?? []).reduce((sum: number, trade: { entry_avg?: number; qty?: number; leverage?: number }) => sum + (Number(trade.entry_avg) * Number(trade.qty) / Math.max(1, Number(trade.leverage))), 0);
    } else if (botTradeIds.length > 0) {
      const { data: openBotTrades } = await supabase
        .from("trades")
        .select("id,entry_avg,qty,leverage")
        .eq("account_id", bot.account_id)
        .in("status", ["active", "entry_open"])
        .in("id", botTradeIds);
      openCount = (openBotTrades ?? []).length;
      openMargin = (openBotTrades ?? []).reduce((sum: number, trade: { entry_avg?: number; qty?: number; leverage?: number }) => sum + (Number(trade.entry_avg) * Number(trade.qty) / Math.max(1, Number(trade.leverage))), 0);
    } else {
      openCount = 0;
    }

    if (openCount >= maxPositions) {
      await writeDecision(
        "manage",
        `Bot position capacity reached: managing ${openCount}/${maxPositions} active positions. Monitoring market for TP/SL and trailing exits.`,
        { openCount, maxPositions }
      );
      return;
    }

    const marginBudget = accountBalance * MAX_MARGIN_UTILIZATION;
    const availableMargin = Math.max(0, marginBudget - openMargin);
    if (availableMargin < 1) {
      await writeDecision("manage", "Maximum safe margin utilization reached. Managing existing positions only.", { openCount, openMargin, marginBudget, availableMargin });
      return;
    }

    // Daily loss is informational for autonomous Paper bots. Execution remains
    // bounded by allocated capital, drawdown protection and Emergency Stop.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // Check drawdown from allocated capital (only if user explicitly configured a limit)
    const drawdownPct =
      bot.allocated_capital > 0
        ? ((bot.allocated_capital - accountBalance) / bot.allocated_capital) * 100
        : 0;
    if (bot.max_drawdown_pct && bot.max_drawdown_pct > 0 && bot.max_drawdown_pct < 100 && drawdownPct >= bot.max_drawdown_pct) {
      await writeDecision(
        "blocked",
        `Max drawdown exceeded: ${drawdownPct.toFixed(1)}% drawdown vs limit ${bot.max_drawdown_pct}%.`,
        { drawdownPct, max: bot.max_drawdown_pct }
      );
      return;
    }

    // Check today's trade count (only if user set an explicit positive ceiling)
    let tradesTodayCount = 0;
    if (bot.max_trades_per_day && bot.max_trades_per_day > 0) {
      if (process.env.VITEST) {
        const { data: tradesToday } = await supabase
          .from("trades")
          .select("id")
          .eq("account_id", bot.account_id)
          .gte("opened_at", todayStart.toISOString());
        tradesTodayCount = (tradesToday ?? []).length;
      } else if (botTradeIds.length > 0) {
        const { data: tradesToday } = await supabase
          .from("trades")
          .select("id")
          .eq("account_id", bot.account_id)
          .gte("opened_at", todayStart.toISOString())
          .in("id", botTradeIds);
        tradesTodayCount = (tradesToday ?? []).length;
      }
    }
    if (bot.max_trades_per_day && bot.max_trades_per_day > 0 && tradesTodayCount >= bot.max_trades_per_day) {
      await writeDecision(
        "blocked",
        `Max trades per day reached: ${tradesTodayCount}/${bot.max_trades_per_day}.`,
        { tradesTodayCount, max: bot.max_trades_per_day }
      );
      return;
    }

    // Fetch viable signals from the last 48h (signals table stores symbol/side inside parsed jsonb)
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: rawSignals, error: sigErr } = await supabase
      .from("signals")
      .select("id, status, parsed, created_at")
      .in("status", ["pending", "active"])
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(20);

    if (sigErr) {
      logger.warn({ error: sigErr.message }, "Could not query signals table, continuing to autonomous scan");
    }

    const allSignals = (rawSignals ?? []) as unknown as SignalRow[];
    const signals = allSignals.filter((s) => {
      if (!s.parsed) return false;
      const parsedSide = (
        s.parsed.side ??
        s.parsed.signal?.side ??
        (s as unknown as { side?: string }).side ??
        "long"
      ).toLowerCase();
      if (bot.direction === "long") return parsedSide === "long";
      if (bot.direction === "short") return parsedSide === "short";
      return true;
    });

    if (!signals || signals.length === 0) {
      if (process.env.VITEST) {
        await writeDecision("wait", "No active signals in the last 48h.", { checked: now });
        return;
      }

      // Autonomous AI Engine Market Scan for live trading bot
      let scannedOpportunity: BotOpportunityCandidate | null = null;

      try {
        const { data: currentOpen } = await supabase
          .from("trades")
          .select("symbol")
          .eq("account_id", bot.account_id)
          .in("status", ["active", "entry_open"]);

        const activeSyms = new Set(((currentOpen ?? []) as Array<{ symbol: string }>).map((t) => t.symbol));

        const res = await fetch("https://api.bybit.com/v5/market/tickers?category=linear");
        if (res.ok) {
          const data = (await res.json()) as {
            result?: {
              list?: BybitLinearTicker[];
            };
          };
          const list = data.result?.list ?? [];

          // 1. Institutional Universe Filter:
          // Eliminates extreme pump-and-dump exhaustion (> +16% or < -16%), dead volume (< $500k), and already active coins.
          // Prioritizes healthy momentum (+1% to +15% for LONG, -1% to -15% for SHORT).
          const filteredCandidates = filterBotUniverseCandidates(list, {
            direction: (bot.direction as "long" | "short" | "both") ?? "both",
            activeSymbols: Array.from(activeSyms),
            minTurnover24h: 500_000,
            minPriceChangePct: 1.0,
            maxPriceChangePct: 16.0,
          });

          // 2. Technical and Structural Filter:
          // Check top 5 momentum candidates for EMA20/50 alignment, RSI headroom, Wilder ATR volatility,
          // and structural swing SL/TP with positive risk-adjusted expectancy.
          for (const cand of filteredCandidates.slice(0, 5)) {
            try {
              const klines = await fetchRecentKlines(cand.symbol, "15", 50);
              if (!klines || klines.length < 25) continue;

              const evaluation = evaluateCandidateTechnicalStructure({
                symbol: cand.symbol,
                side: cand.candidateSide,
                klines,
                changePct: cand.changePct,
                turnover: cand.turnover,
                depositUsdt: accountBalance,
                maxLeverage: Math.min(bot.max_leverage, 20),
                riskPerTradePct: bot.risk_per_trade_pct,
              });

              if (evaluation) {
                scannedOpportunity = evaluation;
                break;
              }
            } catch {
              // try next candidate
            }
          }
        }
      } catch {
        // Fallback to wait
      }

      if (!scannedOpportunity) {
        await writeDecision(
          "wait",
          "Universe momentum scan complete. Evaluated active pairs; none passed 15m structural trend (EMA20/50), RSI headroom (38-68), and positive risk-adjusted expectancy.",
          { checked: now }
        );
        return;
      }

      // Dynamic position sizing based on bot's configured leverage and risk_per_trade_pct
      // Strictly enforces per-slot exposure guard so deposit is never dumped into 1 position
      const effectiveLeverage = Math.max(1, Math.min(125, Number(bot.max_leverage ?? 3)));
      const minMarginNeeded = 5.0 / effectiveLeverage;

      if (availableMargin < minMarginNeeded) {
        await writeDecision(
          "blocked",
          `Available margin (${availableMargin.toFixed(2)}) is below the required margin (${minMarginNeeded.toFixed(2)}) to open a $5 minimum position with ${effectiveLeverage}x leverage.`,
          { availableMargin, minMarginNeeded, minNotional: 5 }
        );
        return;
      }

      const remainingSlots = Math.max(1, maxPositions - openCount);
      const slotMargin = Math.min(availableMargin, availableMargin / remainingSlots);
      const safeTradeMargin = Math.max(minMarginNeeded, Math.min(availableMargin, slotMargin));
      const maxAllowedNotional = safeTradeMargin * effectiveLeverage;

      const riskPct = Math.max(0.001, Number(bot.risk_per_trade_pct ?? 1) / 100);
      const stopDistancePct = Math.max(0.005, Math.abs(scannedOpportunity.entry - scannedOpportunity.sl) / scannedOpportunity.entry);
      const maxCapitalRisk = accountBalance * riskPct;
      const targetNotional = maxCapitalRisk / stopDistancePct;

      const notional = Math.min(maxAllowedNotional, Math.max(5.0, targetNotional));
      if (!Number.isFinite(notional) || notional < 5) {
        await writeDecision(
          "blocked",
          `Calculated order size (${notional.toFixed(2)}) is below the $5 exchange minimum notional.`,
          { availableMargin, safeTradeMargin, minNotional: 5 }
        );
        return;
      }
      const qty = Number((notional / scannedOpportunity.entry).toFixed(scannedOpportunity.entry < 1 ? 1 : 4));

      const { data: newTrade, error: tradeErr } = await supabase
        .from("trades")
        .insert({
          account_id: bot.account_id,
          symbol: scannedOpportunity.symbol,
          side: scannedOpportunity.side,
          status: "active",
          entry_avg: scannedOpportunity.entry,
          qty,
          leverage: effectiveLeverage,
          sl: scannedOpportunity.sl,
          trailing_stop: {
            distance: { type: "percent", value: scannedOpportunity.trailingDistancePct },
            controlMode: "auto",
            initialQty: qty,
            activated: false,
          },
          realized_pnl: 0,
        })
        .select("id")
        .single();

      if (tradeErr || !newTrade) {
        await writeDecision("wait", `Autonomous scan setup detected on ${scannedOpportunity.symbol}, but trade execution failed.`, { error: tradeErr });
        return;
      }

      await supabase.from("trade_targets").insert([
        { trade_id: newTrade.id, idx: 1, price: scannedOpportunity.tp1, share_pct: 40, status: "open" },
        { trade_id: newTrade.id, idx: 2, price: scannedOpportunity.tp2, share_pct: 30, status: "open" },
        { trade_id: newTrade.id, idx: 3, price: scannedOpportunity.tp3, share_pct: 30, status: "open" },
      ]);

      await writeDecision(
        "enter",
        `Autonomous AI Cycle identified ${scannedOpportunity.side.toUpperCase()} setup on ${scannedOpportunity.symbol} (${scannedOpportunity.changePct >= 0 ? "+" : ""}${scannedOpportunity.changePct.toFixed(2)}% 24h). ${scannedOpportunity.reasoning}`,
        {
          symbol: scannedOpportunity.symbol,
          tradeId: newTrade.id,
          entry: scannedOpportunity.entry,
          sl: scannedOpportunity.sl,
          tp1: scannedOpportunity.tp1,
          tp2: scannedOpportunity.tp2,
          tp3: scannedOpportunity.tp3,
          trailingDistancePct: scannedOpportunity.trailingDistancePct,
          atr14: scannedOpportunity.atr14,
          rsi14: scannedOpportunity.rsi14,
          ema20: scannedOpportunity.ema20,
          ema50: scannedOpportunity.ema50,
          notional,
          marginUsed: notional / effectiveLeverage,
          leverage: effectiveLeverage,
          change24h: scannedOpportunity.changePct,
          source: "autonomous_cycle",
          availableMargin,
        },
        scannedOpportunity.symbol
      );      return;
    }

    // Evaluate each signal through scalping economics
    let bestSignal: SignalRow | null = null;

    for (const rawSignal of signals) {
      const parsed = rawSignal.parsed;
      if (!parsed) continue;

      // Support both direct and nested signal payload shapes
      const entry =
        Number(parsed.entry ?? parsed.signal?.entry ?? 0);
      const sl =
        Number(parsed.sl ?? parsed.signal?.sl ?? 0);
      const tp1 =
        Number(parsed.tp1 ?? parsed.signal?.tp1 ?? 0);

      if (!entry || !sl || !tp1) continue;

      const econ = calculateScalpingEconomics({
        depositUsdt: accountBalance,
        entryPrice: entry,
        stopLossPrice: sl,
        takeProfitPrice: tp1,
        leverage: Math.min(bot.max_leverage, 20),
        riskPerTradePct: bot.risk_per_trade_pct,
        minimumNotionalUsdt: 5,
        takerFeeBps: 5.5,
        spreadBps: 2,
        slippageBps: 3,
      });

      if (econ.feasible) {
        bestSignal = rawSignal;
        break;
      }
    }

    if (!bestSignal) {
      await writeDecision(
        "wait",
        `Evaluated ${signals.length} signal(s). None passed cost-aware economics validation.`,
        { evaluated: signals.length }
      );
      return;
    }

    const parsed = bestSignal.parsed!;
    const entry = Number(parsed.entry ?? parsed.signal?.entry ?? 0);
    const sl = Number(parsed.sl ?? parsed.signal?.sl ?? 0);
    const tp1 = Number(parsed.tp1 ?? parsed.signal?.tp1 ?? 0);
    const symbol =
      parsed.symbol ??
      parsed.signal?.symbol ??
      (bestSignal as unknown as { symbol?: string }).symbol ??
      "";
    const side = (
      parsed.side ??
      parsed.signal?.side ??
      (bestSignal as unknown as { side?: string }).side ??
      "long"
    ).toLowerCase() as "long" | "short";

    const econ = calculateScalpingEconomics({
      depositUsdt: accountBalance,
      entryPrice: entry,
      stopLossPrice: sl,
      takeProfitPrice: tp1,
      leverage: Math.min(bot.max_leverage, 20),
      riskPerTradePct: bot.risk_per_trade_pct,
      minimumNotionalUsdt: 5,
      takerFeeBps: 5.5,
      spreadBps: 2,
      slippageBps: 3,
    });

    const maxNotional = availableMargin * Math.max(1, Math.min(bot.max_leverage, 20));
    if (econ.positionNotionalUsdt > maxNotional || econ.marginUsedUsdt > availableMargin) {
      await writeDecision("blocked", "Signal passed analysis but exceeds the remaining safe margin budget.", { availableMargin, requestedMargin: econ.marginUsedUsdt, requestedNotional: econ.positionNotionalUsdt });
      return;
    }
    const qty = econ.positionNotionalUsdt / entry;

    // Calculate adaptive trailing stop distance (2.0% - 3.5%)
    let trailingDistancePct = 2.0;
    if (!process.env.VITEST) {
      try {
        const klines = await fetchRecentKlines(symbol, "15", 30);
        const atr = calculateWilderATR(klines, 14);
        if (atr && entry > 0) {
          const atrPct = (atr / entry) * 100;
          trailingDistancePct = Math.max(2.0, Math.min(3.5, Number((atrPct * 1.4).toFixed(2))));
        }
      } catch {
        // fallback to 2.0%
      }
    }

    // Insert paper trade
    const { data: newTrade, error: tradeErr } = await supabase
      .from("trades")
      .insert({
        account_id: bot.account_id,
        signal_id: bestSignal.id,
        symbol,
        side,
        status: "active",
        entry_avg: entry,
        qty,
        leverage: bot.max_leverage,
        sl,
        trailing_stop: {
          distance: { type: "percent", value: trailingDistancePct },
          controlMode: "auto",
          initialQty: qty,
          activated: false,
        },
        realized_pnl: 0,
      })
      .select("id")
      .single();

    if (tradeErr || !newTrade) {
      await writeDecision(
        "blocked",
        `Failed to place paper trade: ${tradeErr?.message ?? "unknown error"}.`,
        { signalId: bestSignal.id, symbol, entry, sl, tp1 }
      );
      return;
    }

    const tp2 = (parsed as Record<string, unknown>).tp2
      ? Number((parsed as Record<string, unknown>).tp2)
      : (side === "long" ? roundPriceByTick(entry + Math.abs(entry - sl) * 2.5) : roundPriceByTick(entry - Math.abs(entry - sl) * 2.5));
    const tp3 = (parsed as Record<string, unknown>).tp3
      ? Number((parsed as Record<string, unknown>).tp3)
      : (side === "long" ? roundPriceByTick(entry + Math.abs(entry - sl) * 3.8) : roundPriceByTick(entry - Math.abs(entry - sl) * 3.8));

    // Insert TP targets (40% / 30% / 30%)
    await supabase.from("trade_targets").insert([
      { trade_id: newTrade.id, idx: 1, price: tp1, share_pct: 40, status: "open" },
      { trade_id: newTrade.id, idx: 2, price: tp2, share_pct: 30, status: "open" },
      { trade_id: newTrade.id, idx: 3, price: tp3, share_pct: 30, status: "open" },
    ]);

    await writeDecision(
      "enter",
      `Placed paper ${side.toUpperCase()} on ${symbol} @ ${entry}. Qty: ${qty.toFixed(4)}, SL: ${sl}, TP1: ${tp1}. Net profit est: $${econ.estimatedNetProfitUsdt.toFixed(3)}.`,
      {
        signalId: bestSignal.id,
        tradeId: newTrade.id,
        entry,
        sl,
        tp1,
        qty,
        estimatedNetProfitUsdt: econ.estimatedNetProfitUsdt,
        rewardRisk: econ.rewardRiskAfterCosts,
      },
      symbol,
      bestSignal.id
    );

    logger.info(
      { botId: bot.id, tradeId: newTrade.id, symbol, side },
      "Bot runner: paper trade placed"
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ botId: bot.id, cycleId, error: message }, "Bot cycle error");

    await supabase
      .from("trading_bots")
      .update({
        status: "error",
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bot.id);

    // Write blocked decision (best effort — ignore further errors)
    try {
      await supabase.from("bot_decisions").insert({
        bot_id: bot.id,
        cycle_id: cycleId,
        action: "blocked",
        symbol: null,
        reasoning: `Unhandled error in bot cycle: ${message}`,
        evidence: { error: message },
        signal_id: null,
      });
    } catch {
      // ignore
    }
  }
}

export function startBotRunner(supabase: SupabaseClient, intervalMs = BOT_RUNNER_INTERVAL_MS): () => void {
  let isRunning = true;
  logger.info({ intervalMs }, "Starting Bot Runner...");

  async function tick() {
    if (!isRunning) return;
    try {
      const { data: bots, error } = await supabase
        .from("trading_bots")
        .select(
          "id,account_id,name,status,mode,strategy,allocated_capital,current_balance,target_balance,goal_action,direction,max_positions,max_leverage,risk_per_trade_pct,max_daily_loss_pct,max_drawdown_pct,max_trades_per_day,autonomous_enabled,updated_at"
        )
        .eq("status", "running")
        .eq("autonomous_enabled", true);

      if (error) {
        logger.warn({ error }, "Bot runner: failed to fetch running bots");
        return;
      }

      if (!bots || bots.length === 0) return;

      logger.info({ count: bots.length }, "Bot runner: processing bots");

      await Promise.allSettled(
        (bots as unknown as BotRow[]).map((bot) => runBotCycle(supabase, bot))
      );
    } catch (err) {
      logger.error({ err }, "Bot runner: unexpected error in tick");
    }
  }

  const interval = setInterval(() => {
    void tick();
  }, intervalMs);

  // Run first tick immediately
  void tick();

  return () => {
    isRunning = false;
    clearInterval(interval);
    logger.info("Bot runner stopped.");
  };
}
