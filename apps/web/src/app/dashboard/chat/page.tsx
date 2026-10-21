import { VexqoraLogo } from "../../../components/logo";
import { accountConnectionSchema, createAccountClient } from "../../../lib/account-client";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { SignalComposer } from "./signal-composer";
import { z } from "zod";

const messageSchema = z.object({ id: z.string(), role: z.string(), kind: z.string(), content: z.string(), created_at: z.string() });
const tradeSchema = z.object({ id: z.string(), symbol: z.string(), side: z.enum(["long", "short"]), status: z.string(), entry_avg: z.coerce.number().nullable(), qty: z.coerce.number().nullable(), leverage: z.coerce.number().nullable(), sl: z.coerce.number().nullable(), realized_pnl: z.coerce.number().nullable() });

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ error?: string; queued?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const query = await searchParams;
  const { data: rawAccount } = await supabase.from("exchange_accounts")
    .select("id, label, exchange, environment, api_key_enc, api_secret_enc, paper_balance")
    .eq("is_active", true).single();
  const account = accountConnectionSchema.nullable().parse(rawAccount);
  let balance: number | null = null;
  if (account) {
    try { balance = (await createAccountClient(account).getBalance()).equity; } catch { balance = null; }
  }

  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [messagesResult, openTradesResult, todayResult, weekResult, riskResult] = account ? await Promise.all([
    supabase.from("chat_messages").select("id, role, kind, content, created_at").eq("account_id", account.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("trades").select("id, symbol, side, status, entry_avg, qty, leverage, sl, realized_pnl").eq("account_id", account.id).in("status", ["entry_open", "active"]).order("opened_at", { ascending: false }).limit(1),
    supabase.from("trades").select("realized_pnl").eq("account_id", account.id).gte("closed_at", dayStart.toISOString()),
    supabase.from("trades").select("realized_pnl").eq("account_id", account.id).gte("closed_at", weekStart).eq("status", "closed"),
    supabase.from("risk_settings").select("max_daily_loss_pct").eq("account_id", account.id).single()
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: null }];

  const messages = z.array(messageSchema).parse(messagesResult.data ?? []);
  const activeTrade = z.array(tradeSchema).parse(openTradesResult.data ?? [])[0] ?? null;
  const todayPnl = (todayResult.data ?? []).reduce((sum: number, row: { realized_pnl: unknown }) => sum + Number(row.realized_pnl ?? 0), 0);
  const weekly = weekResult.data ?? [];
  const winRate = weekly.length ? Math.round(weekly.filter((row: { realized_pnl: unknown }) => Number(row.realized_pnl ?? 0) > 0).length / weekly.length * 100) : null;
  const maxDailyLoss = Number((riskResult.data as { max_daily_loss_pct?: unknown } | null)?.max_daily_loss_pct ?? 0);
  const openRisk = activeTrade && balance ? Math.abs((activeTrade.entry_avg ?? 0) - (activeTrade.sl ?? 0)) * (activeTrade.qty ?? 0) / balance * 100 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}>
      <section className="metric-grid">
        <article className="panel metric"><div className="metric-data"><span className="kicker">Equity</span><strong className="mono">{balance === null ? "—" : `${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`}</strong></div></article>
        <article className="panel metric"><div className="metric-data"><span className="kicker">Today PnL</span><strong className={`mono ${todayPnl >= 0 ? "positive" : "negative"}`}>{todayPnl >= 0 ? "+" : ""}${todayPnl.toFixed(2)}</strong></div></article>
        <article className="panel metric"><div className="metric-data"><span className="kicker">Open risk</span><strong className="mono">{openRisk.toFixed(2)}%<small>of {maxDailyLoss.toFixed(1)}% daily limit</small></strong></div></article>
        <article className="panel metric"><div className="metric-data"><span className="kicker">Win rate · 7D</span><strong className="mono">{winRate === null ? "—" : `${winRate}%`}</strong></div></article>
      </section>
      {query.error ? <p className="notice error">{query.error}</p> : null}
      {query.queued ? <p className="notice success">Signal queued for execution.</p> : null}
      <section className="trade-workspace">
        <div className="panel chat-panel">
          <div className="chat-scroll">
            {messages.length ? messages.map((message) => <article className={`message ${message.role}`} key={message.id}><small>{message.kind.replaceAll("_", " ")}</small><p>{message.content}</p></article>) : <div className="empty-state"><VexqoraLogo size={42} /><h2>Vexqora Signal Desk</h2><p>Paste a signal to calculate its position size and risk using your active workspace balance.</p></div>}
          </div>
          {account ? <SignalComposer /> : <p className="notice error" style={{ marginTop: "auto" }}>Your workspace is not initialized. Open Accounts and create Vexqora Paper.</p>}
        </div>
        <aside className="panel active-trade">
          {activeTrade ? <>
            <div className="active-title"><div><strong>{activeTrade.symbol}</strong> <span className={`badge ${activeTrade.side}`}>{activeTrade.side} {activeTrade.leverage ?? 1}x</span></div><span className="badge demo">{activeTrade.status}</span></div>
            <div className={`pnl mono ${(activeTrade.realized_pnl ?? 0) >= 0 ? "positive" : "negative"}`}>{activeTrade.realized_pnl === null ? "Open" : `${activeTrade.realized_pnl >= 0 ? "+" : ""}$${activeTrade.realized_pnl.toFixed(2)}`}</div>
            <span className="kicker">Position</span>
            <div className="level"><span className="demo-text">Entry</span><span className="mono">{activeTrade.entry_avg ?? "—"}</span></div>
            <div className="level"><span>Quantity</span><span className="mono">{activeTrade.qty ?? "—"}</span></div>
            <div className="level"><span className="negative">SL</span><span className="mono">{activeTrade.sl ?? "—"}</span></div>
          </> : <div className="empty-state"><span className="kicker">Active trade</span><h2>No open position</h2><p>Confirmed positions and their exchange or paper status will appear here.</p></div>}
          <div className="trade-controls"><button className="button secondary" disabled={!activeTrade}>Close 50%</button><button className="button secondary" disabled={!activeTrade}>Move SL to BE</button><button className="button danger" disabled={!activeTrade}>Close all positions</button></div>
        </aside>
      </section>
    </div>
  );
}
