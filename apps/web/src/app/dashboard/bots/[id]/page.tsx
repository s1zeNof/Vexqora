import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { setBotStatus } from "../actions";

type BotStatus = "running" | "stopped" | "paused" | "error";

interface BotDecisionItem {
  id: number;
  cycle_id: string;
  action: "enter" | "wait" | "manage" | "exit" | "blocked";
  symbol: string | null;
  reasoning: string;
  evidence: Record<string, unknown>;
  created_at: string;
}

interface OpenTradeItem {
  id: string;
  symbol: string;
  side: "long" | "short";
  status: string;
  entry_avg: number | null;
  qty: number | null;
  leverage: number | null;
  sl: number | null;
  realized_pnl: number | null;
  created_at: string;
}

const ACTION_COLORS: Record<string, string> = {
  enter: "#00E676",
  wait: "#64748B",
  manage: "#38BDF8",
  exit: "#F59E0B",
  blocked: "#EF4444",
};

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

  const { data: rawDecisions } = await supabase
    .from("bot_decisions")
    .select("id,cycle_id,action,symbol,reasoning,evidence,created_at")
    .eq("bot_id", id)
    .order("created_at", { ascending: false })
    .limit(30);

  const decisions = (rawDecisions ?? []) as unknown as BotDecisionItem[];

  const { data: rawPositions } = await supabase
    .from("trades")
    .select("id,symbol,side,status,entry_avg,qty,leverage,sl,realized_pnl,created_at")
    .eq("account_id", accountId)
    .in("status", ["active", "entry_open"])
    .order("created_at", { ascending: false });

  const openPositions = (rawPositions ?? []) as unknown as OpenTradeItem[];

  const pnl = balance - allocated;
  const pnlPct = allocated > 0 ? (pnl / allocated) * 100 : 0;
  const pnlColor = pnl > 0 ? "#00E676" : pnl < 0 ? "#EF4444" : "#94A3B8";

  const statusColors: Record<BotStatus, string> = {
    running: "#00E676",
    stopped: "#64748B",
    paused: "#F59E0B",
    error: "#EF4444",
  };

  return (
    <div className="bot-detail">
      <div className="bot-detail__topbar">
        <Link href="/dashboard/bots" className="bot-detail__back">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 12L6 8l4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>All Bots</span>
        </Link>
      </div>

      <header className="bot-detail__header">
        <div className="bot-detail__title">
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: statusColors[botStatus] ?? "#64748B",
              boxShadow: botStatus === "running" ? "0 0 10px rgba(0, 230, 118, 0.5)" : undefined,
              flexShrink: 0,
            }}
          />
          <h1>{botName}</h1>
          <span className="badge badge--paper">{botMode.toUpperCase()}</span>
          <span className={`badge badge--status-${botStatus}`}>{botStatus}</span>
        </div>
        {botDesc && <p className="bot-detail__desc">{botDesc}</p>}
      </header>

      {botStatus === "error" && lastErr && (
        <div className="bots-notice bots-notice--error">
          <strong>Bot error:</strong> {lastErr}
        </div>
      )}

      <div className="bot-detail__grid">
        {/* Performance card */}
        <section className="bot-detail__card">
          <h2>Performance &amp; Balance</h2>
          <dl className="bot-detail__dl">
            <div>
              <dt>Allocated Capital</dt>
              <dd className="mono">${allocated.toFixed(2)} USDT</dd>
            </div>
            <div>
              <dt>Current Balance</dt>
              <dd className="mono">${balance.toFixed(2)} USDT</dd>
            </div>
            <div>
              <dt>Total PnL</dt>
              <dd className="mono" style={{ color: pnlColor, fontWeight: 700 }}>
                {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
              </dd>
            </div>
            {target && (
              <div>
                <dt>Target Balance</dt>
                <dd className="mono">${target.toFixed(2)} USDT</dd>
              </div>
            )}
          </dl>
        </section>

        {/* Config card */}
        <section className="bot-detail__card">
          <h2>Autonomous Parameters</h2>
          <dl className="bot-detail__dl">
            <div>
              <dt>Execution Mode</dt>
              <dd>{botStrategy.toUpperCase()}</dd>
            </div>
            <div>
              <dt>Risk Per Trade</dt>
              <dd className="mono">{riskPct}%</dd>
            </div>
            <div>
              <dt>Max Daily Loss Guard</dt>
              <dd className="mono">{maxLossPct}%</dd>
            </div>
            <div>
              <dt>Goal Action</dt>
              <dd>{goalAct}</dd>
            </div>
          </dl>
        </section>

        {/* State & Controls */}
        <section className="bot-detail__card">
          <h2>Controls &amp; Status</h2>
          <div className="bot-detail__controls-wrap">
            <div className="bot-detail__heartbeat">
              <span>Runner heartbeat:</span>{" "}
              {heartbeat
                ? new Intl.DateTimeFormat("en", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }).format(new Date(heartbeat))
                : "Awaiting activation"}
            </div>
            <div className="bot-detail__controls">
              <form action={setBotStatus} style={{ display: "contents" }}>
                <input type="hidden" name="id" value={botId} />
                {botStatus !== "running" && (
                  <button className="btn btn--start" name="intent" value="start" type="submit">
                    <svg viewBox="0 0 16 16" fill="currentColor">
                      <path d="M4 3l9 5-9 5V3z" />
                    </svg>
                    <span>Start Bot</span>
                  </button>
                )}
                {botStatus === "running" && (
                  <button className="btn btn--pause" name="intent" value="pause" type="submit">
                    <svg viewBox="0 0 16 16" fill="currentColor">
                      <path d="M4.5 3h2v10h-2V3zm5 0h2v10h-2V3z" />
                    </svg>
                    <span>Pause Bot</span>
                  </button>
                )}
                <button className="btn btn--stop" name="intent" value="stop" type="submit">
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <rect x="3" y="3" width="10" height="10" rx="1.5" />
                  </svg>
                  <span>Emergency Stop</span>
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>

      {/* Open Positions */}
      <section className="bot-detail__section">
        <h2>Open Positions ({openPositions.length})</h2>
        {openPositions.length === 0 ? (
          <div className="bots-empty" style={{ padding: "28px 16px" }}>
            <span>No open positions for this bot&apos;s account right now.</span>
          </div>
        ) : (
          <div className="bot-detail__table-wrap">
            <table className="bot-detail__table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Entry Price</th>
                  <th>Qty</th>
                  <th>Stop Loss</th>
                  <th>PnL</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.map((pos) => (
                  <tr key={pos.id}>
                    <td><strong>{pos.symbol}</strong></td>
                    <td style={{ color: pos.side === "long" ? "#00E676" : "#EF4444", fontWeight: 750 }}>
                      {pos.side.toUpperCase()}
                    </td>
                    <td className="mono">${pos.entry_avg ? Number(pos.entry_avg).toFixed(2) : "—"}</td>
                    <td className="mono">{pos.qty ?? "—"}</td>
                    <td className="mono" style={{ color: "#EF4444" }}>
                      {pos.sl ? `$${Number(pos.sl).toFixed(2)}` : "—"}
                    </td>
                    <td className="mono" style={{ color: Number(pos.realized_pnl) >= 0 ? "#00E676" : "#EF4444" }}>
                      {pos.realized_pnl ? `$${Number(pos.realized_pnl).toFixed(2)}` : "$0.00"}
                    </td>
                    <td>
                      <span className="badge badge--status-running">{pos.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Decisions Log */}
      <section className="bot-detail__section">
        <h2>Autonomous Decision Audit Log ({decisions.length})</h2>
        {decisions.length === 0 ? (
          <div className="bots-empty" style={{ padding: "28px 16px" }}>
            <span>No decisions recorded yet. Start the bot to begin market scanning cycles.</span>
          </div>
        ) : (
          <div className="bot-decisions">
            {decisions.map((dec) => {
              const actionColor = ACTION_COLORS[dec.action] ?? "#64748B";
              return (
                <div key={dec.id} className="bot-decision">
                  <div className="bot-decision__meta">
                    <span
                      className="badge"
                      style={{
                        background: `${actionColor}15`,
                        color: actionColor,
                        border: `1px solid ${actionColor}40`,
                      }}
                    >
                      {dec.action.toUpperCase()}
                    </span>
                    {dec.symbol && <strong style={{ color: "#F8FAFC", fontSize: 13 }}>{dec.symbol}</strong>}
                    <time style={{ color: "#64748B", fontSize: 11, marginLeft: "auto" }}>
                      {new Intl.DateTimeFormat("en", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }).format(new Date(dec.created_at))}
                    </time>
                  </div>
                  <p style={{ margin: "6px 0 0", fontSize: 13, color: "#CBD5E1", lineHeight: 1.5 }}>
                    {dec.reasoning}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
