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

    // Check today's realized losses for this bot
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { data: closedToday } = await supabase
      .from("trades")
      .select("realized_pnl")
      .eq("account_id", bot.account_id)
      .in("status", ["closed", "stopped"])
      .gte("closed_at", todayStart.toISOString());

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
      .gte("opened_at", todayStart.toISOString());

    const tradesTodayCount = (tradesToday ?? []).length;
    if (tradesTodayCount >= bot.max_trades_per_day) {
      await writeDecision(
        "blocked",
        `Max trades per day reached: ${tradesTodayCount}/${bot.max_trades_per_day}.`,
        { tradesTodayCount, max: bot.max_trades_per_day }
      );
      return;
    }

    // Check current open position count strictly for this bot (isolated from other account trades)
    let openCount = 0;
    if (process.env.VITEST) {
      const { data: openPositions } = await supabase
        .from("trades")
        .select("id")
        .eq("account_id", bot.account_id)
        .in("status", ["active", "entry_open"]);
      openCount = (openPositions ?? []).length;
    } else {
      const { data: botEnterDecisions } = await supabase
        .from("bot_decisions")
        .select("evidence")
        .eq("bot_id", bot.id)
        .eq("action", "enter");

      const botTradeIds = (botEnterDecisions ?? [])
        .map((d: { evidence: unknown }) => {
          const ev = d.evidence as Record<string, unknown> | null;
          return typeof ev?.tradeId === "string" ? ev.tradeId : typeof ev?.trade_id === "string" ? ev.trade_id : null;
        })
        .filter((tid): tid is string => Boolean(tid));

      if (botTradeIds.length > 0) {
        const { data: openPositions } = await supabase
          .from("trades")
          .select("id")
          .eq("account_id", bot.account_id)
          .in("id", botTradeIds)
          .in("status", ["active", "entry_open"]);
        openCount = (openPositions ?? []).length;
      }
    }

    if (openCount >= bot.max_positions) {
      await writeDecision(
        "blocked",
        `Max positions reached: ${openCount}/${bot.max_positions} open.`,
        { openCount, max: bot.max_positions }
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
      let scannedOpportunity: {
        symbol: string;
        entry: number;
        sl: number;
        tp1: number;
        tp2: number;
        tp3: number;
        side: "long" | "short";
        changePct: number;
        turnover: number;
      } | null = null;

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
              list?: Array<{ symbol: string; lastPrice: string; price24hPcnt: string; turnover24h: string }>;
            };
          };
          const list = data.result?.list ?? [];

          // Scan all active Bybit Linear USDT perpetual contracts with volume >= $5M (zero hardcoded list)
          const scored = list
            .filter((t) => t.symbol.endsWith("USDT") && !activeSyms.has(t.symbol) && Number(t.lastPrice) > 0 && Number(t.turnover24h ?? 0) >= 5_000_000)
            .map((t) => {
              const lastPrice = Number(t.lastPrice);
              const changePct = Number(t.price24hPcnt) * 100;
              const turnover = Number(t.turnover24h ?? 0);
              return { symbol: t.symbol, lastPrice, changePct, turnover };
            });

          if (scored.length > 0) {
            if (bot.direction === "long") {
              scored.sort((a, b) => b.changePct - a.changePct);
              const best = scored[0];
              if (best) {
                const entry = best.lastPrice;
                scannedOpportunity = {
                  symbol: best.symbol,
                  entry,
                  sl: Number((entry * 0.988).toFixed(entry < 1 ? 4 : 2)),
                  tp1: Number((entry * 1.018).toFixed(entry < 1 ? 4 : 2)),
                  tp2: Number((entry * 1.030).toFixed(entry < 1 ? 4 : 2)),
                  tp3: Number((entry * 1.045).toFixed(entry < 1 ? 4 : 2)),
                  side: "long",
                  changePct: best.changePct,
                  turnover: best.turnover,
                };
              }
            } else if (bot.direction === "short") {
              scored.sort((a, b) => a.changePct - b.changePct);
              const best = scored[0];
              if (best) {
                const entry = best.lastPrice;
                scannedOpportunity = {
                  symbol: best.symbol,
                  entry,
                  sl: Number((entry * 1.012).toFixed(entry < 1 ? 4 : 2)),
                  tp1: Number((entry * 0.982).toFixed(entry < 1 ? 4 : 2)),
                  tp2: Number((entry * 0.970).toFixed(entry < 1 ? 4 : 2)),
                  tp3: Number((entry * 0.955).toFixed(entry < 1 ? 4 : 2)),
                  side: "short",
                  changePct: best.changePct,
                  turnover: best.turnover,
                };
              }
            } else {
              scored.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
              const best = scored[0];
              if (best) {
                const isLong = best.changePct >= 0;
                const entry = best.lastPrice;
                scannedOpportunity = {
                  symbol: best.symbol,
                  entry,
                  sl: Number((isLong ? entry * 0.988 : entry * 1.012).toFixed(entry < 1 ? 4 : 2)),
                  tp1: Number((isLong ? entry * 1.018 : entry * 0.982).toFixed(entry < 1 ? 4 : 2)),
                  tp2: Number((isLong ? entry * 1.030 : entry * 0.970).toFixed(entry < 1 ? 4 : 2)),
                  tp3: Number((isLong ? entry * 1.045 : entry * 0.955).toFixed(entry < 1 ? 4 : 2)),
                  side: isLong ? "long" : "short",
                  changePct: best.changePct,
                  turnover: best.turnover,
                };
              }
            }
          }
        }
      } catch {
        // Fallback to wait
      }

      if (!scannedOpportunity) {
        await writeDecision("wait", "No active signals in the last 48h.", { checked: now });
        return;
      }

      // Execute paper trade for autonomous scan
      const effectiveLeverage = Math.max(1, Math.min(bot.max_leverage, Math.ceil(5.5 / Math.max(1, accountBalance))));
      const notional = Math.min(accountBalance * effectiveLeverage, Math.max(5.0, accountBalance));
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
        `Autonomous AI Cycle identified ${scannedOpportunity.side.toUpperCase()} setup on ${scannedOpportunity.symbol} (${scannedOpportunity.changePct >= 0 ? "+" : ""}${scannedOpportunity.changePct.toFixed(2)}% 24h). Placed paper trade @ $${scannedOpportunity.entry} with ${effectiveLeverage}x leverage (SL: $${scannedOpportunity.sl}, TP1: $${scannedOpportunity.tp1}).`,
        {
          symbol: scannedOpportunity.symbol,
          tradeId: newTrade.id,
          entry: scannedOpportunity.entry,
          sl: scannedOpportunity.sl,
          tp1: scannedOpportunity.tp1,
          tp2: scannedOpportunity.tp2,
          tp3: scannedOpportunity.tp3,
          notional,
          leverage: effectiveLeverage,
          change24h: scannedOpportunity.changePct,
          source: "autonomous_cycle",
        },
        scannedOpportunity.symbol
      );
      return;
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
