import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import {
  BotDetailView,
  type BotStatus,
  type BotDecisionItem,
  type OpenTradeItem,
  type ClosedTradeItem,
} from "./bot-detail-view";

export default async function BotDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rawBot } = await supabase
    .from("trading_bots")
    .select(
      "id,name,description,status,mode,strategy,allocated_capital,current_balance,target_balance,risk_per_trade_pct,max_daily_loss_pct,max_drawdown_pct,goal_action,autonomous_enabled,last_heartbeat_at,last_error,created_at,account_id"
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!rawBot) notFound();

  const botRecord = rawBot as Record<string, unknown>;
  const botId = typeof botRecord.id === "string" ? botRecord.id : id;
  const botName = typeof botRecord.name === "string" ? botRecord.name : "Trading Bot";
  const botStatus = (typeof botRecord.status === "string" ? botRecord.status : "stopped") as BotStatus;
  const botMode = typeof botRecord.mode === "string" ? botRecord.mode : "paper";
  const botStrategy = typeof botRecord.strategy === "string" ? botRecord.strategy : "scalping";
  const botDesc = typeof botRecord.description === "string" ? botRecord.description : null;
  const allocated = Number(botRecord.allocated_capital ?? 0);
  const balance = Number(botRecord.current_balance ?? 0);
  const target = botRecord.target_balance ? Number(botRecord.target_balance) : null;
  const riskPct = Number(botRecord.risk_per_trade_pct ?? 1);
  const maxLossPct = Number(botRecord.max_daily_loss_pct ?? 5);
  const goalAct = typeof botRecord.goal_action === "string" ? botRecord.goal_action : "pause";
  const heartbeat = typeof botRecord.last_heartbeat_at === "string" ? botRecord.last_heartbeat_at : null;
  const lastErr = typeof botRecord.last_error === "string" ? botRecord.last_error : null;
  const accountId = typeof botRecord.account_id === "string" ? botRecord.account_id : "";
  const createdAt = typeof botRecord.created_at === "string" ? botRecord.created_at : new Date().toISOString();

  // Load decision log
  const { data: rawDecisions } = await supabase
    .from("bot_decisions")
    .select("id,cycle_id,action,symbol,reasoning,evidence,created_at")
    .eq("bot_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  const decisions = (rawDecisions ?? []) as unknown as BotDecisionItem[];

  // Extract trade IDs strictly initiated by this bot to isolate from other account trades
  const botTradeIds = decisions
    .map((d) => {
      const ev = d.evidence as Record<string, unknown> | null;
      if (typeof ev?.tradeId === "string") return ev.tradeId;
      if (typeof ev?.trade_id === "string") return ev.trade_id;
      return null;
    })
    .filter((tid): tid is string => Boolean(tid));

  let openPositions: OpenTradeItem[] = [];
  let closedTrades: ClosedTradeItem[] = [];

  if (botTradeIds.length > 0) {
    // Load active trades initiated by this bot
    const { data: rawActive } = await supabase
      .from("trades")
      .select("id,symbol,side,status,entry_avg,qty,leverage,sl,realized_pnl,created_at")
      .eq("account_id", accountId)
      .in("id", botTradeIds)
      .in("status", ["active", "entry_open"])
      .order("created_at", { ascending: false });

    openPositions = rawActive ?? [];

    // Load closed trades archive initiated by this bot
    const { data: rawClosed } = await supabase
      .from("trades")
      .select("id,symbol,side,status,entry_avg,exit_price,exit_reason,qty,leverage,sl,realized_pnl,opened_at,closed_at")
      .eq("account_id", accountId)
      .in("id", botTradeIds)
      .in("status", ["closed", "stopped"])
      .order("closed_at", { ascending: false })
      .limit(50);

    closedTrades = rawClosed ?? [];
  }

  return (
    <BotDetailView
      bot={{
        id: botId,
        name: botName,
        description: botDesc,
        status: botStatus,
        mode: botMode,
        strategy: botStrategy,
        allocated_capital: allocated,
        current_balance: balance,
        target_balance: target,
        risk_per_trade_pct: riskPct,
        max_daily_loss_pct: maxLossPct,
        goal_action: goalAct,
        last_heartbeat_at: heartbeat,
        last_error: lastErr,
        created_at: createdAt,
      }}
      decisions={decisions}
      openPositions={openPositions}
      closedTrades={closedTrades}
    />
  );
}
