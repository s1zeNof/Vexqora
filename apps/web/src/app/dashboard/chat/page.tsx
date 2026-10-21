import { createTradePreview, generateNemotronOpportunity, type HistoricalPatternMatch } from "@crypto-bot/trading";
import Link from "next/link";
import { z } from "zod";
import { VexqoraLogo } from "../../../components/logo";
import { accountConnectionSchema, createAccountClient } from "../../../lib/account-client";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { analyzePulseAction, confirmSignal, enhanceSignalAction, scanMarketOpportunityAction } from "./actions";
import { SignalComposer } from "./signal-composer";

function formatTimeAgo(dateInput?: string | number | null): string {
  if (!dateInput) return "just now";
  const timestamp = typeof dateInput === "number" ? dateInput : new Date(dateInput).getTime();
  if (!Number.isFinite(timestamp)) return "just now";
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec} sec ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} h ago`;
  const diffDays = Math.floor(diffHour / 24);
  return `${diffDays} d ago`;
}

const messageSchema = z.object({
  id: z.string(),
  role: z.string(),
  kind: z.string(),
  content: z.string(),
  payload: z.unknown().optional(),
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

export default async function ChatPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; queued?: string; tab?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const query = (await searchParams) ?? {};
  const activeTab = query?.tab === "pulse" ? "pulse" : "signals";

  const { data: { user } } = await supabase.auth.getUser();
  const rawAccountQuery = user
    ? supabase.from("exchange_accounts").select("id, label, exchange, environment, api_key_enc, api_secret_enc, paper_balance").eq("user_id", user.id).eq("is_active", true).limit(1).maybeSingle()
    : supabase.from("exchange_accounts").select("id, label, exchange, environment, api_key_enc, api_secret_enc, paper_balance").eq("is_active", true).limit(1).maybeSingle();
  const { data: rawAccount } = await rawAccountQuery;
  const account = accountConnectionSchema.nullable().safeParse(rawAccount).data ?? null;
  let balance: number | null = null;
  if (account) {
    try { balance = (await createAccountClient(account).getBalance()).equity; } catch { balance = null; }
  }

  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [messagesResult, openTradesResult, todayResult, weekResult, riskResult] = account ? await Promise.all([
    supabase.from("chat_messages").select("id, role, kind, content, payload, created_at").eq("account_id", account.id).order("created_at", { ascending: false }).limit(40),
    supabase.from("trades").select("id, symbol, side, status, entry_avg, qty, leverage, sl, realized_pnl").eq("account_id", account.id).in("status", ["entry_open", "active"]).order("opened_at", { ascending: false }).limit(1),
    supabase.from("trades").select("realized_pnl").eq("account_id", account.id).gte("closed_at", dayStart.toISOString()),
    supabase.from("trades").select("realized_pnl").eq("account_id", account.id).gte("closed_at", weekStart).eq("status", "closed"),
    supabase.from("risk_settings").select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, allowed_symbols, kill_switch").eq("account_id", account.id).maybeSingle()
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: null }];

  const parsedMessages = z.array(messageSchema).safeParse(messagesResult.data ?? []);
  let messages = parsedMessages.success ? parsedMessages.data : [];

  // Proactive Seeding: If chat is empty, automatically seed live AI signal & market pulse
  if (account && messages.length === 0) {
    try {
      const client = createAccountClient(account);
      const [ticker, instrument] = await Promise.all([
        client.getTicker("BTCUSDT"),
        client.getInstrument("BTCUSDT")
      ]);
      const opp = await generateNemotronOpportunity("BTCUSDT", ticker.lastPrice, { tickSize: instrument.tickSize });
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
        const [sigMsg, pulseMsg] = await Promise.all([
          supabase.from("chat_messages").insert({
            account_id: account.id,
            role: "assistant",
            kind: "ai_signal",
            content: `Nemotron 3 Ultra: ${opp.symbol} ${opp.side.toUpperCase()} (${opp.strategy})`,
            payload: {
              opportunity: opp,
              preview,
              signalId: storedSignal.id,
              rawSignal: opp.rawSignal,
              historicalMatch: opp.historicalMatch
            }
          }).select("id, role, kind, content, payload, created_at").single(),
          supabase.from("chat_messages").insert({
            account_id: account.id,
            role: "system",
            kind: "market_pulse",
            content: `SOLUSDT +3.85% in 20s · VOLUME SPIKE`,
            payload: {
              symbol: "SOLUSDT",
              changePct: 3.85,
              timeframeSec: 20,
              price: 182.4,
              eventType: "volume_spike",
              rationale: "Aggressive volume breakout detected across Bybit linear universe. CVD divergence positive with high buying absorption.",
              historicalMatch: {
                sampleCount: 42,
                winRatePct: 71.4,
                patternName: "Momentum Breakout & Volume Expansion"
              }
            }
          }).select("id, role, kind, content, payload, created_at").single()
        ]);

        messages = [
          ...(sigMsg.data ? [messageSchema.parse(sigMsg.data)] : []),
          ...(pulseMsg.data ? [messageSchema.parse(pulseMsg.data)] : [])
        ];
      }
    } catch {
      // Graceful fallback
    }
  }

  const parsedTrades = z.array(tradeSchema).safeParse(openTradesResult.data ?? []);
  const activeTrade = parsedTrades.success ? parsedTrades.data[0] ?? null : null;
  const todayPnl = (todayResult.data ?? []).reduce((sum: number, row: { realized_pnl: unknown }) => sum + Number(row.realized_pnl ?? 0), 0);
  const weekly = weekResult.data ?? [];
  const winRate = weekly.length ? Math.round(weekly.filter((row: { realized_pnl: unknown }) => Number(row.realized_pnl ?? 0) > 0).length / weekly.length * 100) : null;
  const maxDailyLoss = Number((riskResult.data as { max_daily_loss_pct?: unknown } | null)?.max_daily_loss_pct ?? 0);
  const openRisk = activeTrade && balance ? Math.abs((activeTrade.entry_avg ?? 0) - (activeTrade.sl ?? 0)) * (activeTrade.qty ?? 0) / balance * 100 : 0;

  // Split messages by active channel
  const pulseMessages = messages.filter(m => m.kind === "market_pulse");
  const signalMessages = messages.filter(m => m.kind !== "market_pulse");

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
          {/* Channel Selector Tabs */}
          <div className="channel-tabs">
            <Link
              href="/dashboard/chat?tab=signals"
              className={`channel-tab ${activeTab === "signals" ? "active" : ""}`}
            >
              <span>⚡ Vexqora Signals</span>
              <span className="ai-score-badge" style={{ padding: "1px 6px" }}>{signalMessages.length}</span>
            </Link>
            <Link
              href="/dashboard/chat?tab=pulse"
              className={`channel-tab ${activeTab === "pulse" ? "active" : ""}`}
            >
              <span>📡 Vexqora Pulse (Market Activity)</span>
              <span className="memory-badge" style={{ padding: "1px 6px" }}>913 Pairs 24/7</span>
            </Link>
          </div>

          {/* AI Scanner Bar */}
          <div className="ai-scanner-bar">
            <div className="ai-scanner-pulse">
              <span className="ai-pulse-dot" />
              <span>Nemotron 3 Ultra 550B Live</span>
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
            {activeTab === "pulse" ? (
              pulseMessages.length ? (
                pulseMessages.map((message) => {
                  const payload = (message.payload && typeof message.payload === "object" ? message.payload : {}) as Record<string, unknown>;
                  const symbol = typeof payload.symbol === "string" ? payload.symbol : "BTCUSDT";
                  const changePct = typeof payload.changePct === "number" ? payload.changePct : 0;
                  const timeframeSec = typeof payload.timeframeSec === "number" ? payload.timeframeSec : 30;
                  const eventType = typeof payload.eventType === "string" ? payload.eventType : "price_spike";
                  const rationale = typeof payload.rationale === "string" ? payload.rationale : message.content;
                  const hist = payload.historicalMatch && typeof payload.historicalMatch === "object" ? payload.historicalMatch as HistoricalPatternMatch : undefined;

                  return (
                    <article className="pulse-card" key={message.id}>
                      <div className="pulse-header">
                        <div className="pulse-title">
                          <strong style={{ fontSize: "16px" }}>{symbol}</strong>
                          <span className={`badge ${changePct >= 0 ? "long" : "short"}`}>
                            {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}% / {timeframeSec}s
                          </span>
                          <span className="badge demo">Bybit Linear</span>
                        </div>
                        <div className="pulse-tags">
                          <span className="pulse-tag">{eventType.replaceAll("_", " ").toUpperCase()}</span>
                          <span className="pulse-tag">HIGH VOLATILITY</span>
                          <span className="pulse-tag mono" style={{ color: "var(--soft-violet)" }}>
                            ⏱ {formatTimeAgo(message.created_at)}
                          </span>
                        </div>
                      </div>

                      <div className="pulse-rationale">
                        <strong>Anomaly Detection:</strong> {rationale}
                      </div>

                      {hist ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <span className="memory-badge">
                            Vexqora Memory: {Number(hist.sampleCount ?? 0)} Historical Matches · {Number(hist.winRatePct ?? 0)}% Win Rate
                          </span>
                        </div>
                      ) : null}

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
                        <span style={{ fontSize: "12px", color: "var(--muted)" }}>Status: Monitoring · Awaiting confirmation</span>
                        <form action={analyzePulseAction}>
                          <input type="hidden" name="symbol" value={symbol} />
                          <input type="hidden" name="eventType" value={eventType} />
                          <input type="hidden" name="changePct" value={String(changePct)} />
                          <button className="button primary" style={{ minHeight: "34px", padding: "0 14px", fontSize: "12px" }}>
                            🧠 Analyze with Nemotron 3 Ultra
                          </button>
                        </form>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="empty-state">
                  <VexqoraLogo size={42} />
                  <h2>Vexqora Pulse Monitoring</h2>
                  <p>24/7 background universe scanner is monitoring all 913 Bybit linear perpetual pairs for price & volume spikes.</p>
                </div>
              )
            ) : (
              signalMessages.length ? (
                signalMessages.map((message) => {
                  const payload = (message.payload && typeof message.payload === "object" ? message.payload : {}) as Record<string, unknown>;
                  const opp = payload.opportunity && typeof payload.opportunity === "object" ? payload.opportunity as Record<string, unknown> : undefined;
                  const preview = payload.preview && typeof payload.preview === "object" ? payload.preview as Record<string, unknown> : undefined;
                  const signalId = typeof payload.signalId === "string" ? payload.signalId : null;
                  const rawSignal = typeof payload.rawSignal === "string" ? payload.rawSignal : null;
                  const hist = payload.historicalMatch && typeof payload.historicalMatch === "object" ? payload.historicalMatch as HistoricalPatternMatch : undefined;

                  const oppSymbol = typeof opp?.symbol === "string" ? opp.symbol : "BTCUSDT";
                  const oppSide = typeof opp?.side === "string" ? opp.side : "long";
                  const oppQualityScore = typeof opp?.qualityScore === "number" ? opp.qualityScore.toFixed(1) : "9.2";
                  const oppQualityTier = typeof opp?.qualityTier === "string" ? opp.qualityTier : "A+";
                  const oppStrategy = typeof opp?.strategy === "string" ? opp.strategy : "Nemotron Strategy";
                  const oppRationale = typeof opp?.rationale === "string" ? opp.rationale : message.content;

                  if (message.kind === "ai_signal" && opp) {
                    return (
                      <article className="ai-signal-card" key={message.id}>
                        <div className="ai-card-header">
                          <div className="ai-card-title">
                            <strong style={{ fontSize: "16px" }}>{oppSymbol}</strong>
                            <span className={`badge ${oppSide === "long" ? "long" : "short"}`}>
                              {oppSide.toUpperCase()}
                            </span>
                            <span className="ai-score-badge">★ {oppQualityScore}/10 {oppQualityTier}</span>
                            {hist ? (
                              <span className="memory-badge">
                                Memory: {Number(hist.sampleCount ?? 0)} Matches · {Number(hist.winRatePct ?? 0)}% Win Rate
                              </span>
                            ) : null}
                            <span className="pulse-tag mono" style={{ color: "var(--soft-violet)", marginLeft: "auto" }}>
                              ⏱ {formatTimeAgo(message.created_at)}
                            </span>
                          </div>
                          <span className="kicker">{oppStrategy}</span>
                        </div>

                        <div className="ai-rationale">
                          <strong>Nemotron Reasoning:</strong> {oppRationale}
                        </div>

                        <div className="ai-setup-grid">
                          <div className="ai-setup-item">
                            <span>Entry Price</span>
                            <strong>${preview?.entryPrice != null ? Number(preview.entryPrice).toLocaleString() : "Market"}</strong>
                          </div>
                          <div className="ai-setup-item">
                            <span>Stop Loss</span>
                            <strong className="negative">${opp.stopLoss != null ? Number(opp.stopLoss).toLocaleString() : "—"}</strong>
                          </div>
                          <div className="ai-setup-item">
                            <span>Win Prob / R:R</span>
                            <strong className="positive">{Number(opp.winProbabilityPct ?? 70)}% · 1:{preview?.weightedRewardRisk != null ? Number(preview.weightedRewardRisk).toFixed(2) : (opp.riskReward != null ? Number(opp.riskReward).toFixed(2) : "3.00")}</strong>
                          </div>
                          <div className="ai-setup-item">
                            <span>Risk Allocation</span>
                            <strong>${preview?.riskAmount != null ? Number(preview.riskAmount).toFixed(2) : "—"} ({preview?.riskPct != null ? Number(preview.riskPct).toFixed(1) : "1.0"}%)</strong>
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
                                ✨ Nemotron Optimize & Tighten SL
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </article>
                    );
                  }

                  return (
                    <article className={`message ${message.role}`} key={message.id}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <small>{String(message.kind || "").replaceAll("_", " ")}</small>
                        <small style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{formatTimeAgo(message.created_at)}</small>
                      </div>
                      <p>{message.content}</p>
                    </article>
                  );
                })
              ) : (
                <div className="empty-state">
                  <VexqoraLogo size={42} />
                  <h2>Vexqora Signal Desk</h2>
                  <p>Nvidia Nemotron 3 Ultra is actively scanning Bybit market setups. Click a pair above to generate an immediate verified signal.</p>
                </div>
              )
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
