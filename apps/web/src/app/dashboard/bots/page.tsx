import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { setBotStatus } from "./actions";
import { BotCreateForm } from "./bot-create-form";

type BotStatus = "running" | "stopped" | "paused" | "error";

interface BotRow {
  id: string;
  name: string;
  description: string | null;
  status: BotStatus;
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

function StatusDot({ status }: { status: BotStatus }) {
  const colors: Record<BotStatus, string> = {
    running: "#00E676",
    stopped: "#64748B",
    paused: "#F59E0B",
    error: "#EF4444",
  };
  return (
    <span
      aria-label={status}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: colors[status],
        flexShrink: 0,
        boxShadow: status === "running" ? "0 0 8px rgba(0, 230, 118, 0.45)" : undefined,
      }}
    />
  );
}

function PnlValue({ allocated, current }: { allocated: number; current: number }) {
  const pnl = current - allocated;
  const pct = allocated > 0 ? (pnl / allocated) * 100 : 0;
  const color = pnl > 0 ? "#00E676" : pnl < 0 ? "#EF4444" : "#94A3B8";
  return (
    <span className="mono" style={{ color, fontSize: 13, fontWeight: 600 }}>
      {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}{" "}
      <span style={{ fontSize: 11, opacity: 0.85 }}>({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%)</span>
    </span>
  );
}

function ProgressBar({ current, target, allocated }: { current: number; target: number; allocated: number }) {
  const pct = Math.min(100, Math.max(0, ((current - allocated) / (target - allocated)) * 100));
  return (
    <div className="target-progress-bar">
      <div className="target-progress-bar__labels">
        <span>Target progress</span>
        <span className="mono">{pct.toFixed(0)}%</span>
      </div>
      <div className="target-progress-bar__track">
        <div style={{ width: `${pct}%` }} className="target-progress-bar__fill" />
      </div>
    </div>
  );
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

  // Never present the mutable runner cache as profit. Reconcile the list from
  // the same closed-trade ledger used by the detail page, so a stale or broken
  // current_balance cannot falsely mark a target as reached.
  const botRows = (bots ?? []) as unknown as BotRow[];
  const botIds = botRows.map((bot) => bot.id);
  const auditedBalanceByBot = new Map<string, number>();
  if (botIds.length > 0) {
    const { data: enterDecisions } = await supabase
      .from("bot_decisions")
      .select("bot_id,trade_id,evidence")
      .in("bot_id", botIds)
      .eq("action", "enter")
      .limit(500);
    const tradeIdsByBot = new Map<string, string[]>();
    for (const decision of enterDecisions ?? []) {
      const evidence = decision.evidence as Record<string, unknown> | null;
      const tradeId = typeof decision.trade_id === "string" ? decision.trade_id : typeof evidence?.tradeId === "string" ? evidence.tradeId : null;
      const botId = typeof decision.bot_id === "string" ? decision.bot_id : null;
      if (tradeId && botId) tradeIdsByBot.set(botId, [...(tradeIdsByBot.get(botId) ?? []), tradeId]);
    }
    const allTradeIds = Array.from(new Set(Array.from(tradeIdsByBot.values()).flat()));
    if (allTradeIds.length > 0) {
      const { data: closedTrades } = await supabase
        .from("trades")
        .select("id,realized_pnl")
        .in("id", allTradeIds)
        .in("status", ["closed", "stopped"]);
      const pnlByTrade = new Map((closedTrades ?? []).map((trade) => [trade.id, Number(trade.realized_pnl ?? 0)]));
      for (const bot of botRows) {
        const ids = tradeIdsByBot.get(bot.id) ?? [];
        if (ids.some((tradeId) => pnlByTrade.has(tradeId))) {
          auditedBalanceByBot.set(bot.id, Math.max(0, Number(bot.allocated_capital) + ids.reduce((sum, tradeId) => sum + (pnlByTrade.get(tradeId) ?? 0), 0)));
        }
      }
    }
  }

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

      {/* New Create Bot Interactive Section */}
      <BotCreateForm paperBalance={paperBalance} />

      {/* Bots Grid */}
      <section className="bots-list-section">
        <div className="bots-list-header">
          <h2 className="bots-section-title">Active Bots ({bots?.length ?? 0})</h2>
          <span className="bots-list-hint">Background runner executes 24/7 independently of open browser tabs</span>
        </div>

        {botsError ? (
          <div className="bots-notice bots-notice--error">
            Could not load bots. Please apply migration <code>202610290001_ai_trading_bots.sql</code> in Supabase.
          </div>
        ) : !bots || bots.length === 0 ? (
          <div className="bots-empty">
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="8" y="14" width="32" height="24" rx="4" />
              <path d="M24 6v8M16 24h.01M32 24h.01M18 32h12" />
            </svg>
            <strong>No active bots</strong>
            <span>Create your first Paper Bot above to begin autonomous algorithmic trading.</span>
          </div>
        ) : (
          <div className="bots-grid">
            {botRows.map((bot) => {
              const displayedBalance = auditedBalanceByBot.get(bot.id) ?? Number(bot.current_balance);
              const hasTarget = bot.target_balance !== null && bot.target_balance > bot.allocated_capital;
              return (
                <article key={bot.id} className={`bot-card bot-card--${bot.status}`}>
                  <div className="bot-card__header">
                    <div className="bot-card__identity">
                      <StatusDot status={bot.status} />
                      <div>
                        <h3 className="bot-card__name">{bot.name}</h3>
                        {bot.description && <p className="bot-card__desc">{bot.description}</p>}
                      </div>
                    </div>
                    <div className="bot-card__badges">
                      <span className="badge badge--paper">{bot.mode.toUpperCase()}</span>
                      <span className="badge badge--strategy">{bot.strategy}</span>
                      <span className={`badge badge--status badge--status-${bot.status}`}>{bot.status}</span>
                    </div>
                  </div>

                  <div className="bot-card__metrics">
                    <div className="bot-card__metric">
                      <span>Allocated</span>
                      <strong className="mono">${Number(bot.allocated_capital).toFixed(2)}</strong>
                    </div>
                    <div className="bot-card__metric">
                      <span>Current Balance</span>
                      <strong className="mono">${displayedBalance.toFixed(2)}</strong>
                    </div>
                    <div className="bot-card__metric">
                      <span>PnL</span>
                      <PnlValue allocated={Number(bot.allocated_capital)} current={displayedBalance} />
                    </div>
                    {bot.target_balance && (
                      <div className="bot-card__metric">
                        <span>Target Goal</span>
                        <strong className="mono">${Number(bot.target_balance).toFixed(2)}</strong>
                      </div>
                    )}
                  </div>

                  {hasTarget && (
                    <ProgressBar
                      current={displayedBalance}
                      target={Number(bot.target_balance)}
                      allocated={Number(bot.allocated_capital)}
                    />
                  )}

                  <div className="bot-card__params">
                    <span>Risk policy: {bot.risk_per_trade_pct}%/trade · Max daily loss: {bot.max_daily_loss_pct}%</span>
                    <span>When target reached: {bot.goal_action}</span>
                  </div>

                  {bot.last_heartbeat_at && (
                    <div className="bot-card__heartbeat">
                      <span>Runner heartbeat:</span>{" "}
                      {new Intl.DateTimeFormat("en", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }).format(new Date(bot.last_heartbeat_at))}
                    </div>
                  )}

                  <div className="bot-card__actions">
                    <form action={setBotStatus} style={{ display: "contents" }}>
                      <input type="hidden" name="id" value={bot.id} />
                      {bot.status !== "running" && (
                        <button className="btn btn--start" name="intent" value="start" type="submit">
                          <svg viewBox="0 0 16 16" fill="currentColor">
                            <path d="M4 3l9 5-9 5V3z" />
                          </svg>
                          <span>Start</span>
                        </button>
                      )}
                      {bot.status === "running" && (
                        <button className="btn btn--pause" name="intent" value="pause" type="submit">
                          <svg viewBox="0 0 16 16" fill="currentColor">
                            <path d="M4.5 3h2v10h-2V3zm5 0h2v10h-2V3z" />
                          </svg>
                          <span>Pause</span>
                        </button>
                      )}
                      <button className="btn btn--stop" name="intent" value="stop" type="submit">
                        <svg viewBox="0 0 16 16" fill="currentColor">
                          <rect x="3" y="3" width="10" height="10" rx="1.5" />
                        </svg>
                        <span>Emergency Stop</span>
                      </button>
                    </form>
                    <Link href={`/dashboard/bots/${bot.id}`} className="btn btn--ghost">
                      Decisions &amp; Details →
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
