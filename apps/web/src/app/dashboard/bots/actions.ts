"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "crypto";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import {
  filterBotUniverseCandidates,
  evaluateCandidateTechnicalStructure,
  type BotOpportunityCandidate,
  type BybitLinearTicker,
} from "@crypto-bot/trading";
import { fetchRecentKlines } from "@crypto-bot/exchange";

export async function createPaperBot(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rawName = formData.get("name");
  const name = typeof rawName === "string" ? rawName.trim() : "";

  const rawDesc = formData.get("description");
  const description = typeof rawDesc === "string" && rawDesc.trim().length > 0 ? rawDesc.trim() : null;

  const rawCapital = formData.get("capital");
  const capital = typeof rawCapital === "string" ? Number(rawCapital) : Number(rawCapital ?? 0);

  const rawTarget = formData.get("target");
  const target = typeof rawTarget === "string" && rawTarget.length > 0 ? Number(rawTarget) : null;

  // Strategy / Market Regime
  const rawStrategy = formData.get("strategy");
  const strategy = typeof rawStrategy === "string" && rawStrategy.length > 0 ? rawStrategy : "adaptive";

  // Dynamic / Custom risk parameters
  const rawRisk = formData.get("risk_per_trade_pct");
  const rawDailyLoss = formData.get("max_daily_loss_pct");

  const riskPerTradePct = typeof rawRisk === "string" && rawRisk.length > 0
    ? Math.min(100, Math.max(0.1, Number(rawRisk)))
    : 1.0;

  const maxDailyLossPct = typeof rawDailyLoss === "string" && rawDailyLoss.length > 0
    ? Math.min(100, Math.max(0.1, Number(rawDailyLoss)))
    : 5.0;

  const maxDrawdownPct = 20.0;
  const maxTradesPerDay = 50;
  const maxLeverage = 3.0;
  const direction = "both"; // Autonomous AI decides Long/Short based on real-time market data

  const rawGoal = formData.get("goal_action");
  const goalAction = typeof rawGoal === "string" && ["stop", "pause", "continue"].includes(rawGoal)
    ? rawGoal
    : "pause";

  if (name.length < 2 || !Number.isFinite(capital) || capital <= 0) {
    redirect("/dashboard/bots?error=invalid");
  }

  const { data: account } = await supabase
    .from("exchange_accounts")
    .select("id,paper_balance")
    .eq("user_id", user.id)
    .eq("exchange", "paper")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!account) {
    redirect("/dashboard/bots?error=account");
  }

  // Ensure DB accepts strategy constraint (map 'adaptive' to scalping in DB if needed or store description note)
  const dbStrategy = strategy.includes("intraday") && !strategy.includes("scalping") ? "intraday" : "scalping";

  let { error } = await supabase.from("trading_bots").insert({
    user_id: user.id,
    account_id: account.id,
    name,
    description: strategy === "adaptive"
      ? (description ? `${description} [AI Adaptive]` : "AI Adaptive Regime Engine")
      : (description ? `${description} [${strategy}]` : `Strategies: ${strategy}`),
    mode: "paper",
    strategy: dbStrategy,
    allocated_capital: capital,
    current_balance: capital,
    target_balance: Number.isFinite(target) && target !== null && target > capital ? target : null,
    risk_per_trade_pct: riskPerTradePct,
    max_daily_loss_pct: maxDailyLossPct,
    max_drawdown_pct: maxDrawdownPct,
    max_trades_per_day: maxTradesPerDay,
    max_leverage: maxLeverage,
    direction,
    goal_action: goalAction,
  });

  if (error && error.message?.includes("trading_bots_risk_per_trade_pct_check")) {
    const fallbackRes = await supabase.from("trading_bots").insert({
      user_id: user.id,
      account_id: account.id,
      name,
      description: strategy === "adaptive"
        ? (description ? `${description} [AI Adaptive]` : "AI Adaptive Regime Engine")
        : (description ? `${description} [${strategy}]` : `Strategies: ${strategy}`),
      mode: "paper",
      strategy: dbStrategy,
      allocated_capital: capital,
      current_balance: capital,
      target_balance: Number.isFinite(target) && target !== null && target > capital ? target : null,
      risk_per_trade_pct: Math.min(5, riskPerTradePct),
      max_daily_loss_pct: Math.min(25, maxDailyLossPct),
      max_drawdown_pct: Math.min(50, maxDrawdownPct),
      max_trades_per_day: maxTradesPerDay,
      max_leverage: maxLeverage,
      direction,
      goal_action: goalAction,
    });
    error = fallbackRes.error;
  }

  if (error) {
    redirect("/dashboard/bots?error=database");
  }

  revalidatePath("/dashboard/bots");
  redirect("/dashboard/bots?created=1");
}

export async function setBotStatus(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rawId = formData.get("id");
  const id = typeof rawId === "string" ? rawId : "";

  const rawIntent = formData.get("intent");
  const intent = typeof rawIntent === "string" ? rawIntent : "stopped";
  const status = intent === "start" ? "running" : intent === "pause" ? "paused" : "stopped";

  await supabase
    .from("trading_bots")
    .update({
      status,
      autonomous_enabled: status === "running",
      ...(status === "running" ? { last_heartbeat_at: null, last_error: null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("mode", "paper");

  revalidatePath("/dashboard/bots");
  revalidatePath(`/dashboard/bots/${id}`);
}

export async function updateBotSettings(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const value = (key: string) => { const raw = formData.get(key); return typeof raw === "string" ? raw : ""; };
  const id = value("id");
  const risk = Math.min(100, Math.max(0.1, Number(value("risk_per_trade_pct")) || 1));
  const targetRaw = Number(value("target_balance"));
  const goal = ["pause", "stop", "continue"].includes(value("goal_action")) ? value("goal_action") : "pause";
  const rawDir = value("direction");
  const direction = ["both", "long", "short"].includes(rawDir) ? rawDir : "both";

  const rawDailyLoss = value("max_daily_loss_pct");
  const maxDailyLossPct = rawDailyLoss && Number(rawDailyLoss) > 0 ? Math.min(100, Math.max(0.1, Number(rawDailyLoss))) : 100;

  const rawDrawdown = value("max_drawdown_pct");
  const maxDrawdownPct = rawDrawdown && Number(rawDrawdown) > 0 ? Math.min(100, Math.max(1, Number(rawDrawdown))) : 100;

  const rawTradesPerDay = value("max_trades_per_day");
  const maxTradesPerDay = rawTradesPerDay && Number(rawTradesPerDay) > 0 ? Math.min(100, Math.max(1, Number(rawTradesPerDay))) : 100;

  const updateErr = (await supabase
    .from("trading_bots")
    .update({
      risk_per_trade_pct: risk,
      target_balance: Number.isFinite(targetRaw) && targetRaw > 0 ? targetRaw : null,
      goal_action: goal,
      direction,
      max_daily_loss_pct: maxDailyLossPct,
      max_drawdown_pct: maxDrawdownPct,
      max_trades_per_day: maxTradesPerDay,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("mode", "paper")).error;

  if (updateErr && updateErr.message?.includes("trading_bots_risk_per_trade_pct_check")) {
    await supabase
      .from("trading_bots")
      .update({
        risk_per_trade_pct: Math.min(5, risk),
        target_balance: Number.isFinite(targetRaw) && targetRaw > 0 ? targetRaw : null,
        goal_action: goal,
        direction,
        max_daily_loss_pct: Math.min(25, maxDailyLossPct),
        max_drawdown_pct: Math.min(50, maxDrawdownPct),
        max_trades_per_day: maxTradesPerDay,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .eq("mode", "paper");
  }

  revalidatePath(`/dashboard/bots/${id}`);
  revalidatePath("/dashboard/bots");
}

export async function triggerBotScan(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rawId = formData.get("id");
  const id = typeof rawId === "string" ? rawId : "";
  if (!id) return;

  const { data: bot } = await supabase
    .from("trading_bots")
    .select("id, name, account_id, status, allocated_capital, current_balance, direction, max_positions, max_leverage, risk_per_trade_pct, strategy")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!bot) return;

  const now = new Date().toISOString();
  const cycleId = randomUUID();
  const balance = Number(bot.current_balance ?? bot.allocated_capital);

  if (!Number.isFinite(balance) || balance <= 0) {
    await supabase.from("bot_decisions").insert({
      bot_id: id,
      cycle_id: cycleId,
      action: "blocked",
      symbol: "UNIVERSE",
      reasoning: "⚡ Scan triggered, but this bot has no available equity. New entries are disabled until Paper balance is funded.",
      evidence: { balance, source: "scan_button" },
    });
    revalidatePath(`/dashboard/bots/${id}`);
    return;
  }

  // Check current open positions
  const { data: openTrades } = await supabase
    .from("trades")
    .select("id, symbol, entry_avg, qty, leverage")
    .eq("account_id", bot.account_id)
    .in("status", ["active", "entry_open"]);

  interface SimpleOpenTrade {
    id: string;
    symbol: string;
    entry_avg?: number;
    qty?: number;
    leverage?: number;
  }
  const openPositions = (openTrades ?? []) as SimpleOpenTrade[];
  const openSymbols = openPositions.map((p) => String(p.symbol));
  const maxPositions = Math.min(Math.max(1, Number(bot.max_positions ?? 1)), 5);

  if (openPositions.length >= maxPositions) {
    await supabase.from("bot_decisions").insert({
      bot_id: id,
      cycle_id: cycleId,
      action: "manage",
      symbol: "UNIVERSE",
      reasoning: `⚡ Market scan executed. Capacity limit: currently managing ${openPositions.length}/${maxPositions} open positions (${openSymbols.join(", ")}). Trailing stop and SL/TP limits are actively enforced.`,
      evidence: {
        open_count: openPositions.length,
        max_positions: maxPositions,
        symbols: openSymbols,
        timestamp: now,
      },
    });

    await supabase
      .from("trading_bots")
      .update({ last_heartbeat_at: now, updated_at: now })
      .eq("id", id);

    revalidatePath(`/dashboard/bots/${id}`);
    revalidatePath("/dashboard/bots");
    return;
  }

  const openMargin = openPositions.reduce(
    (sum, t) => sum + (Number(t.entry_avg ?? 0) * Number(t.qty ?? 0)) / Math.max(1, Number(t.leverage ?? 1)),
    0
  );
  const marginBudget = balance * 0.5;
  const availableMargin = Math.max(0, marginBudget - openMargin);

  if (availableMargin < 1) {
    await supabase.from("bot_decisions").insert({
      bot_id: id,
      cycle_id: cycleId,
      action: "manage",
      symbol: "UNIVERSE",
      reasoning: `⚡ Market scan executed. Maximum safe margin utilization reached ($50% equity cap: $${marginBudget.toFixed(2)}). Managing existing positions only.`,
      evidence: { openMargin, marginBudget, availableMargin, source: "scan_button" },
    });
    revalidatePath(`/dashboard/bots/${id}`);
    return;
  }

  // Fetch live Bybit linear tickers across the perpetual universe
  const activeSymbols = new Set(openSymbols);
  let selectedOpportunity: BotOpportunityCandidate | null = null;

  try {
    const res = await fetch("https://api.bybit.com/v5/market/tickers?category=linear", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as {
        result?: {
          list?: BybitLinearTicker[];
        };
      };
      const list = data.result?.list ?? [];

      // Institutional universe filter: eliminates extreme pump-and-dump exhaustion (> +16% or < -16%), dead volume (< $500k), and active coins
      const filteredCandidates = filterBotUniverseCandidates(list, {
        direction: (bot.direction as "long" | "short" | "both") ?? "both",
        activeSymbols: Array.from(activeSymbols),
        minTurnover24h: 500_000,
        minPriceChangePct: 1.0,
        maxPriceChangePct: 16.0,
      });

      // Technical structure filter: checks EMA20/50 alignment, RSI headroom, Wilder ATR, swing levels, and positive expectancy
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
            depositUsdt: balance,
            maxLeverage: Math.min(Number(bot.max_leverage ?? 3), 20),
            riskPerTradePct: Number(bot.risk_per_trade_pct ?? 1),
          });

          if (evaluation) {
            selectedOpportunity = evaluation;
            break;
          }
        } catch {
          // try next candidate
        }
      }
    }
  } catch {
    // network or api error
  }

  // If no setup qualified
  if (!selectedOpportunity) {
    await supabase.from("bot_decisions").insert({
      bot_id: id,
      cycle_id: cycleId,
      action: "wait",
      symbol: "UNIVERSE",
      reasoning: "⚡ Market scan executed. Universe momentum screener checked active pairs; none passed 15m structural trend (EMA20/50), RSI headroom (38-68), and positive risk-adjusted expectancy.",
      evidence: { source: "scan_button", timestamp: now },
    });

    await supabase
      .from("trading_bots")
      .update({ last_heartbeat_at: now, updated_at: now })
      .eq("id", id);

    revalidatePath(`/dashboard/bots/${id}`);
    revalidatePath("/dashboard/bots");
    return;
  }

  // Dynamic position sizing based on risk per trade & exposure controls
  const effectiveLeverage = Math.max(1, Math.min(125, Number(bot.max_leverage ?? 3)));
  const riskPct = Math.max(0.001, Number(bot.risk_per_trade_pct ?? 1) / 100);
  const stopDistancePct = Math.max(0.005, Math.abs(selectedOpportunity.entry - selectedOpportunity.sl) / selectedOpportunity.entry);
  const maxCapitalRisk = balance * riskPct;
  const targetNotional = maxCapitalRisk / stopDistancePct;
  const maxAllowedNotional = Math.min(balance * effectiveLeverage, availableMargin * effectiveLeverage);
  const notional = Math.min(targetNotional, maxAllowedNotional);

  if (!Number.isFinite(notional) || notional < 5) {
    await supabase.from("bot_decisions").insert({
      bot_id: id,
      cycle_id: cycleId,
      action: "blocked",
      symbol: selectedOpportunity.symbol,
      reasoning: "Scan found a setup, but calculated size is below the $5 minimum notional after risk controls.",
      evidence: { balance, maxAllowedNotional, availableMargin, source: "scan_button" },
    });
    revalidatePath(`/dashboard/bots/${id}`);
    return;
  }
  const qty = Number((notional / selectedOpportunity.entry).toFixed(selectedOpportunity.entry < 1 ? 1 : 4));

  // Place paper trade into database
  const { data: newTrade, error: tradeErr } = await supabase
    .from("trades")
    .insert({
      account_id: bot.account_id,
      symbol: selectedOpportunity.symbol,
      side: selectedOpportunity.side,
      status: "active",
      entry_avg: selectedOpportunity.entry,
      qty,
      leverage: effectiveLeverage,
      sl: selectedOpportunity.sl,
      trailing_stop: {
        distance: { type: "percent", value: selectedOpportunity.trailingDistancePct },
        controlMode: "auto",
        initialQty: qty,
        activated: false,
      },
      realized_pnl: 0,
    })
    .select("id")
    .single();

  if (tradeErr || !newTrade) {
    await supabase.from("bot_decisions").insert({
      bot_id: id,
      cycle_id: cycleId,
      action: "blocked",
      symbol: selectedOpportunity.symbol,
      reasoning: `Market scan found setup on ${selectedOpportunity.symbol}, but trade insertion failed: ${tradeErr?.message ?? "unknown error"}.`,
      evidence: { error: tradeErr },
    });
  } else {
    // Insert multi-stage Take Profit targets (40% / 30% / 30%)
    await supabase.from("trade_targets").insert([
      { trade_id: newTrade.id, idx: 1, price: selectedOpportunity.tp1, share_pct: 40, status: "open" },
      { trade_id: newTrade.id, idx: 2, price: selectedOpportunity.tp2, share_pct: 30, status: "open" },
      { trade_id: newTrade.id, idx: 3, price: selectedOpportunity.tp3, share_pct: 30, status: "open" },
    ]);


    const rawTradeId = (newTrade as { id?: unknown }).id;
    const resolvedTradeId = typeof rawTradeId === "string" ? rawTradeId : "";
    const rawBotStrategy = (bot as { strategy?: unknown }).strategy;
    const resolvedStrategy = typeof rawBotStrategy === "string" ? rawBotStrategy : "scalping";

    await supabase.from("bot_decisions").insert({
      bot_id: id,
      cycle_id: cycleId,
      action: "enter",
      symbol: selectedOpportunity.symbol,
      reasoning: `⚡ Real-time Scan executed. Autonomous AI Engine identified momentum setup on ${selectedOpportunity.symbol} (${selectedOpportunity.changePct >= 0 ? "+" : ""}${selectedOpportunity.changePct.toFixed(2)}% 24h, Turnover $${(selectedOpportunity.turnover / 1e6).toFixed(1)}M). ${selectedOpportunity.reasoning}`,
      evidence: {
        symbol: selectedOpportunity.symbol,
        tradeId: resolvedTradeId,
        entry: selectedOpportunity.entry,
        sl: selectedOpportunity.sl,
        tp1: selectedOpportunity.tp1,
        tp2: selectedOpportunity.tp2,
        tp3: selectedOpportunity.tp3,
        trailingDistancePct: selectedOpportunity.trailingDistancePct,
        atr14: selectedOpportunity.atr14,
        rsi14: selectedOpportunity.rsi14,
        ema20: selectedOpportunity.ema20,
        ema50: selectedOpportunity.ema50,
        qty,
        notional,
        marginUsed: notional / effectiveLeverage,
        leverage: effectiveLeverage,
        change24h: selectedOpportunity.changePct,
        turnover24h: selectedOpportunity.turnover,
        strategy: resolvedStrategy,
        source: "scan_button",
      },
    });
  }

  // Update bot heartbeat
  await supabase
    .from("trading_bots")
    .update({
      last_heartbeat_at: now,
      updated_at: now,
    })
    .eq("id", id);

  revalidatePath(`/dashboard/bots/${id}`);
  revalidatePath("/dashboard/bots");
  revalidatePath("/dashboard/positions");
}

export async function closeTradeManually(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rawTradeId = formData.get("trade_id");
  const rawBotId = formData.get("bot_id");
  const tradeId = typeof rawTradeId === "string" ? rawTradeId : "";
  const botId = typeof rawBotId === "string" ? rawBotId : "";

  if (!tradeId) return;

  const { data: trade } = await supabase
    .from("trades")
    .select("id, account_id, symbol, side, entry_avg, qty, leverage, exchange_accounts!inner(user_id)")
    .eq("id", tradeId)
    .maybeSingle();

  if (trade) {
    let exitPrice = Number(trade.entry_avg ?? 0);
    try {
      const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${trade.symbol}`, { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { result?: { list?: Array<{ lastPrice?: string }> } };
        const p = json.result?.list?.[0]?.lastPrice;
        if (p && Number(p) > 0) exitPrice = Number(p);
      }
    } catch {
      // keep entryPrice fallback
    }

    const entry = Number(trade.entry_avg ?? exitPrice);
    const qty = Number(trade.qty ?? 0);
    const isLong = trade.side === "long";
    const realizedPnl = Number(((isLong ? exitPrice - entry : entry - exitPrice) * qty).toFixed(2));

    await supabase
      .from("trades")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        exit_price: exitPrice,
        realized_pnl: realizedPnl,
        exit_reason: "manual",
        exit_details: { closed_by: "user_dashboard_button", exit_price: exitPrice, realized_pnl: realizedPnl },
      })
      .eq("id", tradeId);

    if (botId) {
      const { data: bot } = await supabase
        .from("trading_bots")
        .select("current_balance")
        .eq("id", botId)
        .maybeSingle();

      if (bot) {
        const newBalance = Math.max(0, Number(bot.current_balance) + realizedPnl);
        await supabase
          .from("trading_bots")
          .update({ current_balance: newBalance, updated_at: new Date().toISOString() })
          .eq("id", botId);
      }
    }
  }

  if (botId) {
    revalidatePath(`/dashboard/bots/${botId}`);
  }
  revalidatePath("/dashboard/bots");
  revalidatePath("/dashboard/positions");
}
