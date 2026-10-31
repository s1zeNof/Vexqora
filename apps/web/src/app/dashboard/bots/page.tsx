import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { BotCreateForm } from "./bot-create-form";
import { BotListView } from "./bot-list-view";
import type { LiveBotSummaryItem } from "../../api/bots/live/route";

interface BotRow {
  id: string;
  name: string;
  description: string | null;
  status: "running" | "stopped" | "paused" | "error";
  mode: string;
  strategy: string;
  allocated_capital: number;
  current_balance: number;
  target_balance: number | null;
  risk_per_trade_pct: number;
  max_daily_loss_pct: number;
  goal_action: string;
  last_heartbeat_at: string | null;
  created_at: string;
}

export default async function BotsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: bots, error: botsError } = await supabase
    .from("trading_bots")
    .select(
      "id,name,description,status,mode,strategy,allocated_capital,current_balance,target_balance,risk_per_trade_pct,max_daily_loss_pct,goal_action,last_heartbeat_at,created_at"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const { data: paperAccount } = await supabase
    .from("exchange_accounts")
    .select("id,paper_balance")
    .eq("user_id", user.id)
    .eq("exchange", "paper")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const paperBalance = Number(paperAccount?.paper_balance ?? 0);

  const botRows = (bots ?? []) as unknown as BotRow[];
  const botIds = botRows.map((bot) => bot.id);
  const auditedBalanceByBot = new Map<string, number>();
  const tradeIdsByBot = new Map<string, string[]>();
  const activePositionsByBot = new Map<string, string[]>();
  const latestDecisionByBot = new Map<
    string,
    { action: string; symbol: string | null; reasoning: string; created_at: string; seconds_ago: number }
  >();
  const now = Date.now();

  if (botIds.length > 0) {
    const { data: decisions } = await supabase
      .from("bot_decisions")
      .select("bot_id,trade_id,action,symbol,reasoning,evidence,created_at")
      .in("bot_id", botIds)
      .order("created_at", { ascending: false })
      .limit(600);

    for (const d of decisions ?? []) {
      const bid = String(d.bot_id);
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
        const ev = d.evidence as Record<string, unknown> | null;
        const tradeId =
          typeof d.trade_id === "string"
            ? d.trade_id
            : typeof ev?.tradeId === "string"
            ? ev.tradeId
            : typeof ev?.trade_id === "string"
            ? ev.trade_id
            : null;
        if (tradeId) {
          tradeIdsByBot.set(bid, [...(tradeIdsByBot.get(bid) ?? []), tradeId]);
        }
      }
    }

    const allTradeIds = Array.from(new Set(Array.from(tradeIdsByBot.values()).flat()));
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

      const openTradesMap = new Map((openTradesRes.data ?? []).map((t) => [String(t.id), String(t.symbol)]));
      const pnlByTrade = new Map((closedTradesRes.data ?? []).map((trade) => [trade.id, Number(trade.realized_pnl ?? 0)]));

      for (const bot of botRows) {
        const ids = tradeIdsByBot.get(bot.id) ?? [];
        const openSyms: string[] = [];
        for (const tid of ids) {
          if (openTradesMap.has(tid)) {
            openSyms.push(openTradesMap.get(tid)!);
          }
        }
        activePositionsByBot.set(bot.id, openSyms);

        if (ids.some((tradeId) => pnlByTrade.has(tradeId))) {
          auditedBalanceByBot.set(
            bot.id,
            Math.max(0, Number(bot.allocated_capital) + ids.reduce((sum, tradeId) => sum + (pnlByTrade.get(tradeId) ?? 0), 0))
          );
        }
      }
    }
  }

  const initialBots: LiveBotSummaryItem[] = botRows.map((bot) => {
    const hbTime = bot.last_heartbeat_at ? new Date(bot.last_heartbeat_at).getTime() : 0;
    const secSinceHb = hbTime > 0 ? Math.max(0, Math.floor((now - hbTime) / 1000)) : null;
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
      seconds_since_heartbeat: secSinceHb,
      is_runner_active: secSinceHb !== null && secSinceHb < 60 && bot.status === "running",
      active_positions_count: activeSyms.length,
      active_symbols: activeSyms,
      latest_decision: latestDecisionByBot.get(bot.id) ?? null,
      created_at: bot.created_at,
    };
  });

  return (
    <div className="bots-page">
      <header className="bots-page__header">
        <div>
          <span className="eyebrow">Autonomous Trading</span>
          <h1>AI Trading Bots</h1>
          <p>Deploy and monitor independent algorithmic trading agents. Paper simulation active by default.</p>
        </div>
        <div className="bots-page__balance">
          <span>Virtual Paper Capital</span>
          <strong className="mono">${paperBalance.toFixed(2)} USDT</strong>
        </div>
      </header>

      {params.created && (
        <div className="bots-notice bots-notice--success" role="status">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 8l3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Bot initialized successfully in Stopped mode. Click <strong>Start</strong> when ready.</span>
        </div>
      )}
      {params.error === "account" && (
        <div className="bots-notice bots-notice--error" role="alert">
          No active Paper trading account found. Please initialize your Paper account in Accounts.
        </div>
      )}
      {params.error === "balance" && (
        <div className="bots-notice bots-notice--error" role="alert">
          Insufficient Paper balance. Reduce allocated capital or fund your virtual account.
        </div>
      )}
      {params.error === "invalid" && (
        <div className="bots-notice bots-notice--error" role="alert">
          Invalid parameters. Name must be at least 2 characters and capital must be positive.
        </div>
      )}
      {params.error === "database" && (
        <div className="bots-notice bots-notice--error" role="alert">
          Database migration required. Ensure <code>202610290001_ai_trading_bots.sql</code> is applied.
        </div>
      )}

      {/* Create Bot Interactive Section */}
      <BotCreateForm paperBalance={paperBalance} />

      {/* Live Bots Grid with 3s AJAX feed */}
      {botsError ? (
        <div className="bots-notice bots-notice--error">
          Could not load bots. Please apply migration <code>202610290001_ai_trading_bots.sql</code> in Supabase.
        </div>
      ) : (
        <BotListView initialBots={initialBots} initialPaperBalance={paperBalance} />
      )}
    </div>
  );
}
