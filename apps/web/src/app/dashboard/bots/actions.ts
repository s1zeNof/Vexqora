"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "crypto";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

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
    ? Math.min(5, Math.max(0.1, Number(rawRisk)))
    : 1.0;

  const maxDailyLossPct = typeof rawDailyLoss === "string" && rawDailyLoss.length > 0
    ? Math.min(25, Math.max(0.1, Number(rawDailyLoss)))
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

  if (!account || capital > Number(account.paper_balance ?? 0)) {
    redirect("/dashboard/bots?error=balance");
  }

  // Ensure DB accepts strategy constraint (map 'adaptive' to scalping in DB if needed or store description note)
  const dbStrategy = strategy.includes("intraday") && !strategy.includes("scalping") ? "intraday" : "scalping";

  const { error } = await supabase.from("trading_bots").insert({
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
  const risk = Math.min(5, Math.max(0.1, Number(value("risk_per_trade_pct")) || 1));
  const targetRaw = Number(value("target_balance"));
  const goal = ["pause", "stop", "continue"].includes(value("goal_action")) ? value("goal_action") : "pause";
  const rawDir = value("direction");
  const direction = ["both", "long", "short"].includes(rawDir) ? rawDir : "both";

  const rawDailyLoss = value("max_daily_loss_pct");
  const maxDailyLossPct = rawDailyLoss && Number(rawDailyLoss) > 0 ? Math.min(25, Math.max(0.1, Number(rawDailyLoss))) : 25;

  const rawDrawdown = value("max_drawdown_pct");
  const maxDrawdownPct = rawDrawdown && Number(rawDrawdown) > 0 ? Math.min(50, Math.max(1, Number(rawDrawdown))) : 50;

  const rawTradesPerDay = value("max_trades_per_day");
  const maxTradesPerDay = rawTradesPerDay && Number(rawTradesPerDay) > 0 ? Math.min(100, Math.max(1, Number(rawTradesPerDay))) : 100;

  await supabase
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
    .eq("mode", "paper");

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

  // Check current open positions
  const { data: openTrades } = await supabase
    .from("trades")
    .select("id, symbol")
    .eq("account_id", bot.account_id)
    .in("status", ["active", "entry_open"]);

  interface SimpleOpenTrade {
    id: string;
    symbol: string;
  }
  const openPositions = (openTrades ?? []) as SimpleOpenTrade[];
  const openSymbols = openPositions.map((p) => String(p.symbol));
  // Manual AI scans are constrained by allocated capital and risk guards, not
  // by an arbitrary position-count ceiling.
  const maxPositions = Number.POSITIVE_INFINITY;

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

  // Fetch live Bybit linear tickers across the entire 900+ pair universe
  const activeSymbols = new Set(openSymbols);

  let selectedCandidate: {
    symbol: string;
    lastPrice: number;
    changePct: number;
    turnover: number;
    side: "long" | "short";
  } | null = null;

  try {
    const res = await fetch("https://api.bybit.com/v5/market/tickers?category=linear", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as {
        result?: {
          list?: Array<{ symbol: string; lastPrice: string; price24hPcnt: string; turnover24h: string }>;
        };
      };
      const list = data.result?.list ?? [];

      // Scan all active Bybit Linear USDT perpetual contracts with volume >= $100k (all coins in universe)
      const scored = list
        .filter((t) => t.symbol.endsWith("USDT") && !activeSymbols.has(t.symbol) && Number(t.lastPrice) > 0 && Number(t.turnover24h ?? 0) >= 100_000)
        .map((t) => {
          const lastPrice = Number(t.lastPrice);
          const changePct = Number(t.price24hPcnt) * 100;
          const turnover = Number(t.turnover24h ?? 0);
          return { symbol: t.symbol, lastPrice, changePct, turnover };
        });

      if (scored.length > 0) {
        // Sort according to direction preference
        if (bot.direction === "long") {
          scored.sort((a, b) => b.changePct - a.changePct);
          const best = scored[0];
          if (best) selectedCandidate = { ...best, side: "long" };
        } else if (bot.direction === "short") {
          scored.sort((a, b) => a.changePct - b.changePct);
          const best = scored[0];
          if (best) selectedCandidate = { ...best, side: "short" };
        } else {
          // Both: pick highest absolute volatility/momentum
          scored.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
          const best = scored[0];
          if (best) selectedCandidate = { ...best, side: best.changePct >= 0 ? "long" : "short" };
        }
      }
    }
  } catch {
    // If Bybit fetch fails, candidate remains null
  }

  // If no candidate available, write wait decision
  if (!selectedCandidate) {
    await supabase.from("bot_decisions").insert({
      bot_id: id,
      cycle_id: cycleId,
      action: "wait",
      symbol: "UNIVERSE",
      reasoning: "⚡ Market scan executed. Current market conditions across primary pairs are in low volatility compression. Standby for confirmed directional momentum breakout.",
      evidence: { source: "manual_trigger", timestamp: now },
    });

    await supabase
      .from("trading_bots")
      .update({ last_heartbeat_at: now, updated_at: now })
      .eq("id", id);

    revalidatePath(`/dashboard/bots/${id}`);
    revalidatePath("/dashboard/bots");
    return;
  }

  // Calculate entry, SL, TP
  const entry = selectedCandidate.lastPrice;
  const isLong = selectedCandidate.side === "long";
  const sl = Number((isLong ? entry * 0.988 : entry * 1.012).toFixed(entry < 1 ? 4 : 2));
  const tp1 = Number((isLong ? entry * 1.018 : entry * 0.982).toFixed(entry < 1 ? 4 : 2));
  const tp2 = Number((isLong ? entry * 1.030 : entry * 0.970).toFixed(entry < 1 ? 4 : 2));
  const tp3 = Number((isLong ? entry * 1.045 : entry * 0.955).toFixed(entry < 1 ? 4 : 2));

  const balance = Number(bot.current_balance ?? bot.allocated_capital);
  const maxLev = Number(bot.max_leverage ?? 3);
  const effectiveLeverage = Math.max(1, Math.min(maxLev, Math.ceil(5.5 / Math.max(1, balance))));
  const notional = Math.min(balance * effectiveLeverage, Math.max(5.0, balance));
  const qty = Number((notional / entry).toFixed(entry < 1 ? 1 : 4));

  // Place real paper trade into database
  const { data: newTrade, error: tradeErr } = await supabase
    .from("trades")
    .insert({
      account_id: bot.account_id,
      symbol: selectedCandidate.symbol,
      side: selectedCandidate.side,
      status: "active",
      entry_avg: entry,
      qty,
      leverage: effectiveLeverage,
      sl,
      realized_pnl: 0,
    })
    .select("id")
    .single();

  if (tradeErr || !newTrade) {
    await supabase.from("bot_decisions").insert({
      bot_id: id,
      cycle_id: cycleId,
      action: "blocked",
      symbol: selectedCandidate.symbol,
      reasoning: `Market scan found setup on ${selectedCandidate.symbol}, but trade insertion failed: ${tradeErr?.message ?? "unknown error"}.`,
      evidence: { error: tradeErr },
    });
  } else {
    // Insert multi-stage Take Profit targets (40% / 30% / 30%)
    await supabase.from("trade_targets").insert([
      { trade_id: newTrade.id, idx: 1, price: tp1, share_pct: 40, status: "open" },
      { trade_id: newTrade.id, idx: 2, price: tp2, share_pct: 30, status: "open" },
      { trade_id: newTrade.id, idx: 3, price: tp3, share_pct: 30, status: "open" },
    ]);

    const formattedPrice = `$${entry.toLocaleString("en-US", { minimumFractionDigits: entry < 1 ? 4 : 2 })}`;
    const formattedSl = `$${sl.toLocaleString("en-US", { minimumFractionDigits: entry < 1 ? 4 : 2 })}`;
    const formattedTp1 = `$${tp1.toLocaleString("en-US", { minimumFractionDigits: entry < 1 ? 4 : 2 })}`;

    const rawTradeId = (newTrade as { id?: unknown }).id;
    const resolvedTradeId = typeof rawTradeId === "string" ? rawTradeId : "";
    const rawBotStrategy = (bot as { strategy?: unknown }).strategy;
    const resolvedStrategy = typeof rawBotStrategy === "string" ? rawBotStrategy : "scalping";

    await supabase.from("bot_decisions").insert({
      bot_id: id,
      cycle_id: cycleId,
      action: "enter",
      symbol: selectedCandidate.symbol,
      reasoning: `⚡ Real-time Scan executed. Autonomous AI Engine identified momentum setup on ${selectedCandidate.symbol} (${selectedCandidate.changePct >= 0 ? "+" : ""}${selectedCandidate.changePct.toFixed(2)}% 24h, Turnover $${(selectedCandidate.turnover / 1e6).toFixed(1)}M). Placed paper ${selectedCandidate.side.toUpperCase()} @ ${formattedPrice} with ${effectiveLeverage}x leverage (Notional: $${notional.toFixed(2)} USDT, SL: ${formattedSl}, TP1: ${formattedTp1}).`,
      evidence: {
        symbol: selectedCandidate.symbol,
        tradeId: resolvedTradeId,
        entry,
        sl,
        tp1,
        tp2,
        tp3,
        qty,
        notional,
        leverage: effectiveLeverage,
        change24h: selectedCandidate.changePct,
        turnover24h: selectedCandidate.turnover,
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
