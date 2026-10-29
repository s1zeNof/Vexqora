import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { calculateScalpingEconomics } from "@crypto-bot/trading/scalping-economics";
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
  symbol: string;
  side: string;
  status: string;
  parsed: {
    entry?: number;
    sl?: number;
    tp1?: number;
    symbol?: string;
    signal?: {
      entry?: number;
      sl?: number;
      tp1?: number;
      symbol?: string;
    };
  } | null;
}

const BOT_RUNNER_INTERVAL_MS = 30_000;

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
    const { error } = await supabase.from("bot_decisions").insert({
      bot_id: bot.id,
      cycle_id: cycleId,
      action,
      symbol: symbol ?? null,
      reasoning,
      evidence,
      signal_id: signalId ?? null,
    });
    if (error) {
      logger.warn({ botId: bot.id, cycleId, error }, "Failed to write bot_decisions row");
    }
  }

  try {
    const accountBalance = Number(bot.current_balance);

    // Check today's realized losses for this bot's account
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { data: closedToday } = await supabase
      .from("trades")
      .select("realized_pnl")
      .eq("account_id", bot.account_id)
      .in("status", ["closed", "stopped"])
      .gte("updated_at", todayStart.toISOString());

    const todayLoss = (closedToday ?? []).reduce((sum, t) => {
      const pnl = Number(t.realized_pnl ?? 0);
      return sum + (pnl < 0 ? Math.abs(pnl) : 0);
    }, 0);

    const maxDailyLossUsdt = (accountBalance * bot.max_daily_loss_pct) / 100;
    if (todayLoss >= maxDailyLossUsdt) {
      await writeDecision(
        "blocked",
        `Daily loss limit reached: lost $${todayLoss.toFixed(2)} of $${maxDailyLossUsdt.toFixed(2)} allowed (${bot.max_daily_loss_pct}%).`,
        { todayLoss, maxDailyLossUsdt }
      );
      return;
    }

    // Check drawdown from allocated capital
    const drawdownPct =
      bot.allocated_capital > 0
        ? ((bot.allocated_capital - accountBalance) / bot.allocated_capital) * 100
        : 0;
    if (drawdownPct >= bot.max_drawdown_pct) {
      await writeDecision(
        "blocked",
        `Max drawdown exceeded: ${drawdownPct.toFixed(1)}% drawdown vs limit ${bot.max_drawdown_pct}%.`,
        { drawdownPct, max: bot.max_drawdown_pct }
      );
      return;
    }

    // Check today's trade count
    const { data: tradesToday } = await supabase
      .from("trades")
      .select("id")
      .eq("account_id", bot.account_id)
      .gte("created_at", todayStart.toISOString());

    const tradesTodayCount = (tradesToday ?? []).length;
    if (tradesTodayCount >= bot.max_trades_per_day) {
      await writeDecision(
        "blocked",
        `Max trades per day reached: ${tradesTodayCount}/${bot.max_trades_per_day}.`,
        { tradesTodayCount, max: bot.max_trades_per_day }
      );
      return;
    }

    // Check current open position count
    const { data: openPositions } = await supabase
      .from("trades")
      .select("id")
      .eq("account_id", bot.account_id)
      .in("status", ["active", "entry_open"]);

    const openCount = (openPositions ?? []).length;
    if (openCount >= bot.max_positions) {
      await writeDecision(
        "blocked",
        `Max positions reached: ${openCount}/${bot.max_positions} open.`,
        { openCount, max: bot.max_positions }
      );
      return;
    }

    // Fetch viable signals from the last 48h
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    let signalQuery = supabase
      .from("signals")
      .select("id, symbol, side, status, parsed")
      .in("status", ["pending", "active"])
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(20);

    if (bot.direction === "long") {
      signalQuery = signalQuery.eq("side", "long");
    } else if (bot.direction === "short") {
      signalQuery = signalQuery.eq("side", "short");
    }

    const { data: signals, error: sigErr } = await signalQuery;

    if (sigErr) {
      await writeDecision("wait", "Failed to fetch signals from database.", { error: sigErr.message });
      return;
    }

    if (!signals || signals.length === 0) {
      await writeDecision("wait", "No active signals in the last 48h.", { checked: now });
      return;
    }

    // Evaluate each signal through scalping economics
    let bestSignal: SignalRow | null = null;

    for (const rawSignal of signals as unknown as SignalRow[]) {
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
    const symbol = bestSignal.symbol ?? parsed.symbol ?? parsed.signal?.symbol ?? "";
    const side = (bestSignal.side ?? "long") as "long" | "short";

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

    const qty = econ.positionNotionalUsdt / entry;

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

    // Insert TP targets (40% / 30% / 30%)
    await supabase.from("trade_targets").insert([
      { trade_id: newTrade.id, idx: 1, price: tp1, share_pct: 40, status: "open" },
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

    // Check goal: if target_balance is set and we've reached/exceeded it
    if (bot.target_balance && accountBalance >= bot.target_balance) {
      const newStatus =
        bot.goal_action === "stop" ? "stopped" : bot.goal_action === "pause" ? "paused" : "running";
      if (newStatus !== "running") {
        await supabase
          .from("trading_bots")
          .update({ status: newStatus, autonomous_enabled: false, updated_at: new Date().toISOString() })
          .eq("id", bot.id);
        logger.info({ botId: bot.id, goal_action: bot.goal_action }, "Bot reached target balance");
      }
    }
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
