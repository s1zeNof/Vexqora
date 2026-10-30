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
      "id,name,description,status,mode,strategy,allocated_capital,current_balance,target_balance,direction,risk_per_trade_pct,max_daily_loss_pct,max_drawdown_pct,goal_action,autonomous_enabled,last_heartbeat_at,last_error,created_at,account_id"
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
  const botDirection = typeof botRecord.direction === "string" ? botRecord.direction : "both";
  const maxLossPct = Number(botRecord.max_daily_loss_pct ?? 5);
  const goalAct = typeof botRecord.goal_action === "string" ? botRecord.goal_action : "pause";
  const heartbeat = typeof botRecord.last_heartbeat_at === "string" ? botRecord.last_heartbeat_at : null;
  const lastErr = typeof botRecord.last_error === "string" ? botRecord.last_error : null;
  const createdAt = typeof botRecord.created_at === "string" ? botRecord.created_at : new Date().toISOString();

  // 1. Load recent decision log for the audit view (50 items)
  const { data: rawDecisions } = await supabase
    .from("bot_decisions")
    .select("id,cycle_id,action,symbol,reasoning,evidence,created_at")
    .eq("bot_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  const decisions = (rawDecisions ?? []) as unknown as BotDecisionItem[];

  // 2. Fetch trade IDs created by this bot from enter decisions (up to 500)
  const { data: enterDecisions } = await supabase
    .from("bot_decisions")
    .select("trade_id,evidence")
    .eq("bot_id", id)
    .eq("action", "enter")
    .order("id", { ascending: false })
    .limit(500);

  const botTradeIds = Array.from(
    new Set(
      (enterDecisions ?? [])
        .map((d) => {
          if (typeof (d as { trade_id?: string | null }).trade_id === "string") {
            return (d as { trade_id: string }).trade_id;
          }
          const ev = d.evidence as Record<string, unknown> | null;
          if (typeof ev?.tradeId === "string") return ev.tradeId;
          if (typeof ev?.trade_id === "string") return ev.trade_id;
          return null;
        })
        .filter((tid): tid is string => Boolean(tid))
    )
  );

  let openPositions: OpenTradeItem[] = [];
  let closedTrades: ClosedTradeItem[] = [];

  if (botTradeIds.length > 0) {
    // 3. Load active trades for this bot (batches of 200 max)
    const lookupIds = botTradeIds.slice(0, 200);
    const { data: rawActive } = await supabase
      .from("trades")
      .select("id,symbol,side,status,entry_avg,qty,leverage,sl,realized_pnl")
      .in("id", lookupIds)
      .in("status", ["active", "entry_open"])
      .order("id", { ascending: false })
      .limit(50);

    openPositions = (rawActive ?? []).map((t) => ({
      ...t,
      created_at: new Date().toISOString(),
    }));

    // 4. Load closed trades archive for this bot
    const { data: rawClosed } = await supabase
      .from("trades")
      .select("id,symbol,side,status,entry_avg,exit_price,exit_reason,qty,leverage,sl,realized_pnl,opened_at,closed_at")
      .in("id", lookupIds)
      .in("status", ["closed", "stopped"])
      .order("closed_at", { ascending: false })
      .limit(100);

    closedTrades = rawClosed ?? [];
  }

  // 3. Load TP targets for all found bot trades to display in tables
  const allBotTradeIds = [...openPositions.map((t) => t.id), ...closedTrades.map((t) => t.id)];

  if (allBotTradeIds.length > 0) {
    const { data: rawTargets } = await supabase
      .from("trade_targets")
      .select("trade_id,idx,price,share_pct,status")
      .in("trade_id", allBotTradeIds)
      .order("idx", { ascending: true });

    const targetsByTradeId = new Map<string, Array<{ idx: number; price: number; share_pct: number; status: string }>>();
    if (rawTargets) {
      for (const tg of rawTargets) {
        const tradeId = String(tg.trade_id);
        const list = targetsByTradeId.get(tradeId) ?? [];
        list.push({
          idx: Number(tg.idx),
          price: Number(tg.price),
          share_pct: Number(tg.share_pct),
          status: String(tg.status),
        });
        targetsByTradeId.set(tradeId, list);
      }
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
        direction: botDirection,
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
