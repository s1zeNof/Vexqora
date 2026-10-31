import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export interface LiveBotSummaryItem {
  id: string;
  name: string;
  description: string | null;
  status: "running" | "stopped" | "paused" | "error";
  mode: string;
  strategy: string;
  allocated_capital: number;
  current_balance: number;
  audited_balance: number;
  target_balance: number | null;
  risk_per_trade_pct: number;
  max_daily_loss_pct: number;
  goal_action: string;
  last_heartbeat_at: string | null;
  seconds_since_heartbeat: number | null;
  is_runner_active: boolean;
  active_positions_count: number;
  active_symbols: string[];
  latest_decision: {
    action: string;
    symbol: string | null;
    reasoning: string;
    created_at: string;
    seconds_ago: number;
  } | null;
  created_at: string;
}

interface DbBotRecord {
  id: string;
  name: string;
  description: string | null;
  status: "running" | "stopped" | "paused" | "error";
  mode: string;
  strategy: string;
  allocated_capital: number | string;
  current_balance: number | string;
  target_balance: number | string | null;
  direction?: string | null;
  risk_per_trade_pct: number | string;
  max_daily_loss_pct: number | string;
  max_drawdown_pct?: number | string;
  goal_action: string;
  autonomous_enabled?: boolean;
  last_heartbeat_at: string | null;
  last_error?: string | null;
  created_at: string;
  account_id?: string;
}

interface DbDecisionRecord {
  id: number;
  bot_id: string;
  cycle_id: string;
  action: string;
  symbol: string | null;
  reasoning: string;
  evidence: Record<string, unknown> | null;
  created_at: string;
  trade_id?: string | null;
}

interface DbTradeRecord {
  id: string;
  symbol: string;
  side: string;
  status: string;
  entry_avg: number | string | null;
  exit_price?: number | string | null;
  exit_reason?: string | null;
  qty: number | string | null;
  leverage: number | string | null;
  sl: number | string | null;
  realized_pnl: number | string | null;
  created_at?: string;
  opened_at?: string | null;
  closed_at?: string | null;
  targets?: Array<{ idx: number; price: number; share_pct: number; status: string }>;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const botId = searchParams.get("botId");
    const now = Date.now();

    // 1. Single bot detail query
    if (botId) {
      const { data: rawBotData, error: botErr } = await supabase
        .from("trading_bots")
        .select(
          "id,name,description,status,mode,strategy,allocated_capital,current_balance,target_balance,direction,risk_per_trade_pct,max_daily_loss_pct,max_drawdown_pct,goal_action,autonomous_enabled,last_heartbeat_at,last_error,created_at,account_id"
        )
        .eq("id", botId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (botErr || !rawBotData) {
        return NextResponse.json({ error: "Bot not found" }, { status: 404 });
      }

      const rawBot = rawBotData as unknown as DbBotRecord;

      // Recent decisions (50)
      const { data: rawDecisions } = await supabase
        .from("bot_decisions")
        .select("id,cycle_id,action,symbol,reasoning,evidence,created_at")
        .eq("bot_id", botId)
        .order("created_at", { ascending: false })
        .limit(50);

      const decisions = (rawDecisions ?? []) as unknown as DbDecisionRecord[];

      // Find trade IDs from enter decisions
      const { data: enterDecisions } = await supabase
        .from("bot_decisions")
        .select("trade_id,evidence")
        .eq("bot_id", botId)
        .eq("action", "enter")
        .order("id", { ascending: false })
        .limit(300);

      const botTradeIds = Array.from(
        new Set(
          (enterDecisions ?? [])
            .map((d) => {
              if (typeof (d as { trade_id?: string | null }).trade_id === "string") {
                return (d as { trade_id: string }).trade_id;
              }
              const ev = (d as { evidence?: unknown }).evidence as Record<string, unknown> | null;
              if (typeof ev?.tradeId === "string") return ev.tradeId;
              if (typeof ev?.trade_id === "string") return ev.trade_id;
              return null;
            })
            .filter((tid): tid is string => Boolean(tid))
        )
      );

      let openPositions: DbTradeRecord[] = [];
      let closedTrades: DbTradeRecord[] = [];

      if (botTradeIds.length > 0) {
        const lookupIds = botTradeIds.slice(0, 200);

        const [activeRes, closedRes] = await Promise.all([
          supabase
            .from("trades")
            .select("id,symbol,side,status,entry_avg,qty,leverage,sl,realized_pnl,created_at")
            .in("id", lookupIds)
            .in("status", ["active", "entry_open"])
            .order("id", { ascending: false })
            .limit(50),
          supabase
            .from("trades")
            .select("id,symbol,side,status,entry_avg,exit_price,exit_reason,qty,leverage,sl,realized_pnl,opened_at,closed_at")
            .in("id", lookupIds)
            .in("status", ["closed", "stopped"])
            .order("closed_at", { ascending: false })
            .limit(100),
        ]);

        openPositions = activeRes.data ?? [];
        closedTrades = closedRes.data ?? [];

        // Fetch targets
        const allTradeIds = [...openPositions.map((t) => t.id), ...closedTrades.map((t) => t.id)];
        if (allTradeIds.length > 0) {
          const { data: rawTargets } = await supabase
            .from("trade_targets")
            .select("trade_id,idx,price,share_pct,status")
            .in("trade_id", allTradeIds)
            .order("idx", { ascending: true });

          const targetsByTradeId = new Map<string, Array<{ idx: number; price: number; share_pct: number; status: string }>>();
          for (const tg of rawTargets ?? []) {
            const tid = String(tg.trade_id);
            const list = targetsByTradeId.get(tid) ?? [];
            list.push({
              idx: Number(tg.idx),
              price: Number(tg.price),
              share_pct: Number(tg.share_pct),
              status: String(tg.status),
            });
            targetsByTradeId.set(tid, list);
          }

          openPositions = openPositions.map((t) => ({
            ...t,
            targets: targetsByTradeId.get(t.id) ?? [],
          }));

          closedTrades = closedTrades.map((t) => ({
            ...t,
            targets: targetsByTradeId.get(t.id) ?? [],
          }));
        }
      }

      const allocated = Number(rawBot.allocated_capital);
      const totalTradesCount = closedTrades.length;
      const realizedPnl = closedTrades.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0);
      const auditedBalance = totalTradesCount > 0 ? Math.max(0, allocated + realizedPnl) : Number(rawBot.current_balance);

      const hbTime = rawBot.last_heartbeat_at ? new Date(rawBot.last_heartbeat_at).getTime() : 0;
      const secondsSinceHb = hbTime > 0 ? Math.max(0, Math.floor((now - hbTime) / 1000)) : null;

      return NextResponse.json({
        success: true,
        bot: {
          ...rawBot,
          allocated_capital: Number(rawBot.allocated_capital),
          current_balance: Number(rawBot.current_balance),
          audited_balance: auditedBalance,
          target_balance: rawBot.target_balance ? Number(rawBot.target_balance) : null,
          risk_per_trade_pct: Number(rawBot.risk_per_trade_pct),
          max_daily_loss_pct: Number(rawBot.max_daily_loss_pct),
          seconds_since_heartbeat: secondsSinceHb,
          is_runner_active: secondsSinceHb !== null && secondsSinceHb < 60 && rawBot.status === "running",
        },
        openPositions,
        closedTrades,
        decisions,
        serverTime: now,
      });
    }

    // 2. All bots summary for main dashboard
    const [botsRes, paperRes] = await Promise.all([
      supabase
        .from("trading_bots")
        .select(
          "id,name,description,status,mode,strategy,allocated_capital,current_balance,target_balance,risk_per_trade_pct,max_daily_loss_pct,goal_action,last_heartbeat_at,created_at"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("exchange_accounts")
        .select("id,paper_balance")
        .eq("user_id", user.id)
        .eq("exchange", "paper")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle(),
    ]);

    const bots = (botsRes.data ?? []) as unknown as DbBotRecord[];
    const paperAccount = paperRes.data as { paper_balance?: unknown } | null;
    const paperBalance = Number(paperAccount?.paper_balance ?? 0);
    const botIds = bots.map((b) => b.id);

    if (botIds.length === 0) {
      return NextResponse.json({
        success: true,
        bots: [],
        paperBalance,
        serverTime: now,
      });
    }

    // Fetch decisions for all user's bots (to get latest decision and trade IDs)
    const { data: recentDecisionsData } = await supabase
      .from("bot_decisions")
      .select("id,bot_id,trade_id,action,symbol,reasoning,evidence,created_at")
      .in("bot_id", botIds)
      .order("created_at", { ascending: false })
      .limit(600);

    const recentDecisions = (recentDecisionsData ?? []) as unknown as DbDecisionRecord[];
    const latestDecisionByBot = new Map<string, { action: string; symbol: string | null; reasoning: string; created_at: string; seconds_ago: number }>();
    const tradeIdsByBot = new Map<string, string[]>();

    for (const d of recentDecisions) {
      const bid = d.bot_id;
      if (!latestDecisionByBot.has(bid)) {
        const dTime = new Date(d.created_at).getTime();
        latestDecisionByBot.set(bid, {
          action: d.action,
          symbol: d.symbol ?? null,
          reasoning: d.reasoning,
          created_at: d.created_at,
          seconds_ago: Math.max(0, Math.floor((now - dTime) / 1000)),
        });
      }

      if (d.action === "enter") {
        const ev = d.evidence;
        const tid = typeof d.trade_id === "string" ? d.trade_id : typeof ev?.tradeId === "string" ? ev.tradeId : typeof ev?.trade_id === "string" ? ev.trade_id : null;
        if (tid) {
          tradeIdsByBot.set(bid, [...(tradeIdsByBot.get(bid) ?? []), tid]);
        }
      }
    }

    // Check open & closed trades
    const allTradeIds = Array.from(new Set(Array.from(tradeIdsByBot.values()).flat()));
    const activePositionsByBot = new Map<string, string[]>();
    const auditedBalanceByBot = new Map<string, number>();

    if (allTradeIds.length > 0) {
      const [openTradesRes, closedTradesRes] = await Promise.all([
        supabase
          .from("trades")
          .select("id,symbol,status")
          .in("id", allTradeIds)
          .in("status", ["active", "entry_open"]),
        supabase
          .from("trades")
          .select("id,realized_pnl")
          .in("id", allTradeIds)
          .in("status", ["closed", "stopped"]),
      ]);

      const openRows = (openTradesRes.data ?? []) as unknown as Array<{ id: string; symbol: string }>;
      const closedRows = (closedTradesRes.data ?? []) as unknown as Array<{ id: string; realized_pnl: number | null }>;

      const openTradesMap = new Map(openRows.map((t) => [t.id, t.symbol]));
      const pnlByTrade = new Map(closedRows.map((t) => [t.id, Number(t.realized_pnl ?? 0)]));

      for (const bot of bots) {
        const ids = tradeIdsByBot.get(bot.id) ?? [];
        const openSyms: string[] = [];
        for (const tid of ids) {
          const found = openTradesMap.get(tid);
          if (found) {
            openSyms.push(found);
          }
        }
        activePositionsByBot.set(bot.id, openSyms);

        if (ids.some((tid) => pnlByTrade.has(tid))) {
          const sumPnl = ids.reduce((acc, tid) => acc + (pnlByTrade.get(tid) ?? 0), 0);
          auditedBalanceByBot.set(bot.id, Math.max(0, Number(bot.allocated_capital) + sumPnl));
        }
      }
    }

    const liveBots: LiveBotSummaryItem[] = bots.map((bot) => {
      const hbTime = bot.last_heartbeat_at ? new Date(bot.last_heartbeat_at).getTime() : 0;
      const secondsSinceHb = hbTime > 0 ? Math.max(0, Math.floor((now - hbTime) / 1000)) : null;
      const activeSyms = activePositionsByBot.get(bot.id) ?? [];
      const auditedBal = auditedBalanceByBot.get(bot.id) ?? Number(bot.current_balance);

      return {
        id: bot.id,
        name: bot.name,
        description: bot.description,
        status: bot.status,
        mode: bot.mode,
        strategy: bot.strategy,
        allocated_capital: Number(bot.allocated_capital),
        current_balance: Number(bot.current_balance),
        audited_balance: auditedBal,
        target_balance: bot.target_balance ? Number(bot.target_balance) : null,
        risk_per_trade_pct: Number(bot.risk_per_trade_pct),
        max_daily_loss_pct: Number(bot.max_daily_loss_pct),
        goal_action: bot.goal_action,
        last_heartbeat_at: bot.last_heartbeat_at,
        seconds_since_heartbeat: secondsSinceHb,
        is_runner_active: secondsSinceHb !== null && secondsSinceHb < 60 && bot.status === "running",
        active_positions_count: activeSyms.length,
        active_symbols: activeSyms,
        latest_decision: latestDecisionByBot.get(bot.id) ?? null,
        created_at: bot.created_at,
      };
    });

    return NextResponse.json({
      success: true,
      bots: liveBots,
      paperBalance,
      serverTime: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
