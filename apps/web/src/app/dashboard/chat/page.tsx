import { createTradePreview, generateOpportunityFromTicker } from "@crypto-bot/trading";
import { z } from "zod";
import { VexqoraLogo } from "../../../components/logo";
import { accountConnectionSchema, createAccountClient } from "../../../lib/account-client";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { confirmSignal, enhanceSignalAction, scanMarketOpportunityAction } from "./actions";
import { SignalComposer } from "./signal-composer";

const messageSchema = z.object({
  id: z.string(),
  role: z.string(),
  kind: z.string(),
  content: z.string(),
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: z.string()
});

const tradeSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  status: z.string(),
  entry_avg: z.coerce.number().nullable(),
  qty: z.coerce.number().nullable(),
  leverage: z.coerce.number().nullable(),
  sl: z.coerce.number().nullable(),
  realized_pnl: z.coerce.number().nullable()
});

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
    supabase.from("chat_messages").select("id, role, kind, content, payload, created_at").eq("account_id", account.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("trades").select("id, symbol, side, status, entry_avg, qty, leverage, sl, realized_pnl").eq("account_id", account.id).in("status", ["entry_open", "active"]).order("opened_at", { ascending: false }).limit(1),
    supabase.from("trades").select("realized_pnl").eq("account_id", account.id).gte("closed_at", dayStart.toISOString()),
    supabase.from("trades").select("realized_pnl").eq("account_id", account.id).gte("closed_at", weekStart).eq("status", "closed"),
    supabase.from("risk_settings").select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, allowed_symbols, kill_switch").eq("account_id", account.id).single()
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: null }];

  let messages = z.array(messageSchema).parse(messagesResult.data ?? []);

  // Proactive AI Seeding: If chat is empty, automatically scan BTCUSDT live market & post initial opportunity
  if (account && messages.length === 0) {
    try {
      const client = createAccountClient(account);
      const [ticker, instrument] = await Promise.all([
        client.getTicker("BTCUSDT"),
        client.getInstrument("BTCUSDT")
      ]);
      const opp = generateOpportunityFromTicker("BTCUSDT", ticker.lastPrice, { tickSize: instrument.tickSize });
      const riskRow = riskResult.data as { risk_per_trade_pct?: number; max_leverage?: number; max_open_positions?: number; max_daily_loss_pct?: number; kill_switch?: boolean } | null;
      const preview = createTradePreview(opp.parsedSignal, instrument, {
        riskPerTradePct: Number(riskRow?.risk_per_trade_pct ?? 1),
        maxLeverage: Number(riskRow?.max_leverage ?? 5),
        maxOpenPositions: Number(riskRow?.max_open_positions ?? 3),
        maxDailyLossPct: Number(riskRow?.max_daily_loss_pct ?? 5),
        killSwitch: Boolean(riskRow?.kill_switch)
      }, { balance: balance ?? 10000, marketPrice: ticker.lastPrice, openPositions: 0, dailyPnl: 0 });

      const { data: stored } = await supabase.from("signals").insert({
        account_id: account.id,
        raw_text: opp.rawSignal,
        parsed: preview,
        source: "chat",
        status: "preview"
      }).select("id").single();

      if (stored) {
        const storedSignal = z.object({ id: z.string().uuid() }).parse(stored);
        const { data: newMsg } = await supabase.from("chat_messages").insert({
          account_id: account.id,
          role: "assistant",
          kind: "ai_signal",
          content: `AI Opportunity: ${opp.symbol} ${opp.side.toUpperCase()} (${opp.strategy})`,
          payload: {
            opportunity: opp,
            preview,
            signalId: storedSignal.id,
            rawSignal: opp.rawSignal
          }
        }).select("id, role, kind, content, payload, created_at").single();

        if (newMsg) {
          messages = [messageSchema.parse(newMsg)];
        }
      }
    } catch {
      // Graceful fallback if market call fails
    }
  }

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
      {query.queued ? <p className="notice success">Signal confirmed! Sent to execution queue for Paper / Bybit.</p> : null}
      <section className="trade-workspace">
        <div className="panel chat-panel">
          {/* AI Scanner Bar */}
          <div className="ai-scanner-bar">
            <div className="ai-scanner-pulse">
              <span className="ai-pulse-dot" />
              <span>AI Copilot Live</span>
            </div>
            <form action={scanMarketOpportunityAction} style={{ display: "inline-flex" }}>
              <input type="hidden" name="symbol" value="BTCUSDT" />
              <button className="ai-chip" type="submit">🎯 Scan BTC</button>
            </form>
            <form action={scanMarketOpportunityAction} style={{ display: "inline-flex" }}>
              <input type="hidden" name="symbol" value="ETHUSDT" />
              <button className="ai-chip" type="submit">🚀 Scan ETH</button>
            </form>
            <form action={scanMarketOpportunityAction} style={{ display: "inline-flex" }}>
              <input type="hidden" name="symbol" value="SOLUSDT" />
              <button className="ai-chip" type="submit">💎 Scan SOL</button>
            </form>
          </div>

          <div className="chat-scroll">
            {messages.length ? messages.map((message) => {
              const payload = message.payload as Record<string, unknown> | null;
              const opp = payload?.opportunity as { symbol?: string; side?: string; qualityScore?: number; qualityTier?: string; strategy?: string; rationale?: string; riskReward?: number; winProbabilityPct?: number; stopLoss?: number } | undefined;
              const preview = payload?.preview as { entryPrice?: number; qty?: number; notional?: number; riskAmount?: number; riskPct?: number; leverage?: number; weightedRewardRisk?: number } | undefined;
              const signalId = (payload?.signalId as string | undefined) ?? null;
              const rawSignal = (payload?.rawSignal as string | undefined) ?? null;

              if (message.kind === "ai_signal" && opp) {
                return (
                  <article className="ai-signal-card" key={message.id}>
                    <div className="ai-card-header">
                      <div className="ai-card-title">
                        <strong style={{ fontSize: "16px" }}>{opp.symbol}</strong>
                        <span className={`badge ${opp.side === "long" ? "long" : "short"}`}>
                          {(opp.side ?? "LONG").toUpperCase()}
                        </span>
                        <span className="ai-score-badge">★ {opp.qualityScore ?? 9.2}/10 {opp.qualityTier ?? "A+"}</span>
                      </div>
                      <span className="kicker">{opp.strategy}</span>
                    </div>

                    <div className="ai-rationale">
                      <strong>AI Edge:</strong> {opp.rationale}
                    </div>

                    <div className="ai-setup-grid">
                      <div className="ai-setup-item">
                        <span>Entry Price</span>
                        <strong>${preview?.entryPrice?.toLocaleString() ?? "Market"}</strong>
                      </div>
                      <div className="ai-setup-item">
                        <span>Stop Loss</span>
                        <strong className="negative">${opp.stopLoss?.toLocaleString() ?? "—"}</strong>
                      </div>
                      <div className="ai-setup-item">
                        <span>Win Prob / R:R</span>
                        <strong className="positive">{opp.winProbabilityPct}% · 1:{preview?.weightedRewardRisk?.toFixed(2) ?? opp.riskReward ?? 3.0}</strong>
                      </div>
                      <div className="ai-setup-item">
                        <span>Risk Allocation</span>
                        <strong>${preview?.riskAmount?.toFixed(2) ?? "—"} ({preview?.riskPct?.toFixed(1) ?? 1}%)</strong>
                      </div>
                    </div>

                    <div className="ai-card-actions">
                      {signalId ? (
                        <form action={confirmSignal}>
                          <input type="hidden" name="signalId" value={signalId} />
                          <button className="button primary" type="submit">
                            🚀 Confirm & Execute Trade
                          </button>
                        </form>
                      ) : null}

                      {rawSignal ? (
                        <form action={enhanceSignalAction}>
                          <input type="hidden" name="rawSignal" value={rawSignal} />
                          <button className="button secondary" type="submit">
                            ✨ AI Optimize & Tighten SL
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </article>
                );
              }

              return (
                <article className={`message ${message.role}`} key={message.id}>
                  <small>{message.kind.replaceAll("_", " ")}</small>
                  <p>{message.content}</p>
                </article>
              );
            }) : (
              <div className="empty-state">
                <VexqoraLogo size={42} />
                <h2>Vexqora Signal Desk</h2>
                <p>AI Copilot is actively scanning Bybit market setups. Click a pair above to generate an immediate verified signal.</p>
              </div>
            )}
          </div>

          {account ? (
            <SignalComposer />
          ) : (
            <p className="notice error" style={{ marginTop: "auto" }}>
              Your workspace is not initialized. Open Accounts and create Vexqora Paper.
            </p>
          )}
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
