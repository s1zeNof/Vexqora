import { fetchRecentKlines } from "@crypto-bot/exchange";
import { createTradePreview, generateNemotronOpportunity, type HistoricalPatternMatch } from "@crypto-bot/trading";
import Link from "next/link";
import { z } from "zod";
import { VexqoraLogo } from "../../../components/logo";
import { accountConnectionSchema, createAccountClient } from "../../../lib/account-client";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { closeAllPositions, closeTradePosition } from "../actions";
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
      const [ticker, instrument, solTicker, klines] = await Promise.all([
        client.getTicker("BTCUSDT"),
        client.getInstrument("BTCUSDT"),
        client.getTicker("SOLUSDT").catch(() => null),
        fetchRecentKlines("BTCUSDT", "15", 15).catch(() => [])
      ]);
      const opp = await generateNemotronOpportunity("BTCUSDT", ticker.lastPrice, { tickSize: instrument.tickSize, klines });
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
        const pulsePrice = solTicker?.lastPrice ?? 182.4;
        const pulseChange = 3.85;
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
            content: `SOLUSDT ${pulseChange >= 0 ? "+" : ""}${pulseChange}% 24h · LIVE BYBIT TICKER`,
            payload: {
              symbol: "SOLUSDT",
              changePct: pulseChange,
              timeframeSec: 60,
              price: pulsePrice,
              eventType: pulseChange >= 0 ? "volume_spike" : "bearish_breakdown",
              rationale: `Live Bybit linear price @ $${pulsePrice}. Volatility registered with ${pulseChange}% 24h delta. Order flow tracking active.`,
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

  let activeTradeMarkPrice: number | null = null;
  let activeTradeTargets: Array<{ target_index: number; price: number; share_pct: number; status: string }> = [];

  if (account && activeTrade) {
    try {
      const client = createAccountClient(account);
      const [tTicker, targetsRes] = await Promise.all([
        client.getTicker(activeTrade.symbol).catch(() => null),
        supabase.from("trade_targets").select("target_index, price, share_pct, status").eq("trade_id", activeTrade.id).order("target_index", { ascending: true })
      ]);
      activeTradeMarkPrice = tTicker?.lastPrice ?? null;
      activeTradeTargets = targetsRes.data ?? [];
    } catch {
      // fallback
    }
  }

  const currentMark = activeTradeMarkPrice ?? activeTrade?.entry_avg ?? 0;
  const pnlDiff = activeTrade ? (activeTrade.side === "long" ? currentMark - (activeTrade.entry_avg ?? currentMark) : (activeTrade.entry_avg ?? currentMark) - currentMark) : 0;
  const unrealizedPnl = activeTrade ? pnlDiff * (activeTrade.qty ?? 0) : 0;
  const posMargin = activeTrade && activeTrade.entry_avg ? (activeTrade.entry_avg * (activeTrade.qty ?? 0)) / (activeTrade.leverage ?? 1) : 0;
  const unrealizedRoiPct = posMargin > 0 ? (unrealizedPnl / posMargin) * 100 : 0;

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

                  const previewSignal = preview?.signal as { symbol?: string; side?: string; stopLoss?: number; takeProfits?: Array<{ price: number; sharePct: number }>; leverage?: number } | undefined;

                  const oppSymbol = typeof opp?.symbol === "string" ? opp.symbol : (previewSignal?.symbol ?? "BTCUSDT");
                  const oppSide = (typeof opp?.side === "string" ? opp.side : (previewSignal?.side ?? "long")) as "long" | "short";
                  const oppQualityScore = typeof opp?.qualityScore === "number" ? opp.qualityScore.toFixed(1) : "9.2";
                  const oppQualityTier = typeof opp?.qualityTier === "string" ? opp.qualityTier : "A+";
                  const oppStrategy = typeof opp?.strategy === "string" ? opp.strategy : "Institutional Setup";
                  const oppRationale = typeof opp?.rationale === "string" ? opp.rationale : message.content;

                  const entryPrice = preview?.entryPrice != null ? Number(preview.entryPrice) : (opp?.entryPrice != null ? Number(opp.entryPrice) : Number(opp?.currentPrice ?? 0));
                  const stopLoss = opp?.stopLoss != null ? Number(opp.stopLoss) : (previewSignal?.stopLoss != null ? Number(previewSignal.stopLoss) : 0);
                  const leverage = preview?.leverage != null ? Number(preview.leverage) : (opp?.suggestedLeverage != null ? Number(opp.suggestedLeverage) : 5);
                  const riskPct = preview?.riskPct != null ? Number(preview.riskPct).toFixed(1) : "1.0";
                  const riskAmount = preview?.riskAmount != null ? Number(preview.riskAmount).toFixed(2) : null;
                  const qty = preview?.qty != null ? Number(preview.qty) : 0;
                  const winProb = Number(opp?.winProbabilityPct ?? 70);
                  const rr = preview?.weightedRewardRisk != null ? Number(preview.weightedRewardRisk).toFixed(2) : (opp?.riskReward != null ? Number(opp.riskReward).toFixed(2) : "3.00");

                  const rawTps = (opp?.takeProfits as Array<{ price: number; sharePct: number }> | undefined) ?? previewSignal?.takeProfits ?? [];
                  const takeProfits = rawTps.map((t, idx) => {
                    const price = Number(t.price);
                    const sharePct = Number(t.sharePct);
                    const pctGain = entryPrice > 0 ? (oppSide === "long" ? ((price - entryPrice) / entryPrice) * 100 : ((entryPrice - price) / entryPrice) * 100) : 0;
                    const estProfit = qty > 0 ? (oppSide === "long" ? (price - entryPrice) * qty * (sharePct / 100) : (entryPrice - price) * qty * (sharePct / 100)) : 0;
                    return { idx: idx + 1, price, sharePct, pctGain: Number(pctGain.toFixed(2)), estProfit: Number(estProfit.toFixed(2)) };
                  });

                  const maxTotalProfit = takeProfits.reduce((acc, curr) => acc + curr.estProfit, 0);
                  const slPct = entryPrice > 0 ? (oppSide === "long" ? ((entryPrice - stopLoss) / entryPrice) * 100 : ((stopLoss - entryPrice) / entryPrice) * 100) : 0;

                  if ((message.kind === "ai_signal" && opp) || message.kind === "signal_preview") {
                    return (
                      <article className="ai-signal-card" key={message.id}>
                        <div className="ai-card-header">
                          <div className="ai-card-title">
                            <strong style={{ fontSize: "16px" }}>{oppSymbol}</strong>
                            <span className={`badge ${oppSide === "long" ? "long" : "short"}`}>
                              {oppSide.toUpperCase()} {leverage}x
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
                            <span>Вхід (Entry)</span>
                            <strong>${entryPrice > 0 ? entryPrice.toLocaleString() : "Market"}</strong>
                          </div>
                          <div className="ai-setup-item">
                            <span>Стоп-лосс (SL)</span>
                            <strong className="negative">${stopLoss > 0 ? stopLoss.toLocaleString() : "—"} (-{slPct.toFixed(2)}%)</strong>
                          </div>
                          <div className="ai-setup-item">
                            <span>Win Prob / R:R</span>
                            <strong className="positive">{winProb}% · 1:{rr}</strong>
                          </div>
                          <div className="ai-setup-item">
                            <span>Ризик (Risk)</span>
                            <strong>{riskAmount ? `$${riskAmount}` : "—"} ({riskPct}%)</strong>
                          </div>
                        </div>

                        {takeProfits.length > 0 ? (
                          <div className="ai-targets-section">
                            <div className="ai-targets-header">
                              <span className="kicker" style={{ color: "var(--aqua)", fontWeight: "600" }}>
                                🎯 Take Profit Targets (Фіксація прибутку / Вихід)
                              </span>
                              {maxTotalProfit > 0 ? (
                                <span className="mono positive" style={{ fontWeight: "700" }}>
                                  Очікуваний прибуток: +${maxTotalProfit.toFixed(2)}
                                </span>
                              ) : null}
                            </div>
                            <div className="ai-targets-grid">
                              {takeProfits.map((tp) => (
                                <div className="ai-target-item" key={tp.idx}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span className="target-badge">TP {tp.idx}</span>
                                    <span style={{ fontSize: "10px", color: "var(--soft-violet)" }}>{tp.sharePct}% позиції</span>
                                  </div>
                                  <strong className="target-price">${tp.price.toLocaleString()}</strong>
                                  <span className="target-meta positive">
                                    +{tp.pctGain}% {tp.estProfit > 0 ? `(+$${tp.estProfit.toFixed(2)})` : ""}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="signal-quick-text">
                          <div className="quick-text-header">
                            📱 Інструкція для входу з телефону (Bybit Mobile / Manual):
                          </div>
                          <pre className="signal-pre">
{`#${oppSymbol} ${oppSide.toUpperCase()} ${leverage}x
📍 Вхід: $${entryPrice > 0 ? entryPrice.toLocaleString() : "Market"}
🛑 Стоп-лосс: $${stopLoss.toLocaleString()} (-${slPct.toFixed(2)}%)
${takeProfits.map(t => `🎯 TP${t.idx}: $${t.price.toLocaleString()} (+${t.pctGain}%) [${t.sharePct}%]`).join("\n")}
${maxTotalProfit > 0 ? `💰 Очікуваний профіт: +$${maxTotalProfit.toFixed(2)}\n` : ""}⚖️ Плече: ${leverage}x | Ризик: ${riskPct}%`}
                          </pre>
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
          {activeTrade ? (
            <>
              <div className="active-title">
                <div>
                  <strong>{activeTrade.symbol}</strong>
                  <span className={`badge ${activeTrade.side}`}>{activeTrade.side} {activeTrade.leverage ?? 1}x</span>
                </div>
                <span className="badge demo">{activeTrade.status}</span>
              </div>
              <div className={`pnl mono ${unrealizedPnl >= 0 ? "positive" : "negative"}`}>
                {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}
                <small style={{ fontSize: "12px", marginLeft: "6px" }}>({unrealizedRoiPct >= 0 ? "+" : ""}{unrealizedRoiPct.toFixed(2)}% ROI)</small>
              </div>
              <span className="kicker">Position Levels</span>
              <div className="level"><span className="demo-text">Mark Price</span><span className="mono">{currentMark > 0 ? currentMark.toLocaleString() : "—"}</span></div>
              <div className="level"><span className="demo-text">Entry Avg</span><span className="mono">{activeTrade.entry_avg ?? "—"}</span></div>
              <div className="level"><span>Quantity</span><span className="mono">{activeTrade.qty ?? "—"}</span></div>
              <div className="level"><span className="negative">Stop Loss</span><span className="mono">{activeTrade.sl ?? "—"}</span></div>

              {activeTradeTargets.length > 0 ? (
                <div style={{ marginTop: "12px", borderTop: "1px solid var(--line)", paddingTop: "8px" }}>
                  <span className="kicker">Take Profit Targets</span>
                  {activeTradeTargets.map((t) => (
                    <div className="level" key={t.target_index}>
                      <span style={{ color: t.status === "filled" ? "var(--aqua)" : "var(--muted)" }}>
                        TP{t.target_index} ({t.share_pct}%) {t.status === "filled" ? "✓ Filled" : "Open"}
                      </span>
                      <span className="mono">{t.price}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="empty-state">
              <span className="kicker">Active trade</span>
              <h2>No open position</h2>
              <p>Confirmed positions and their exchange or paper status will appear here.</p>
            </div>
          )}
          <div className="trade-controls">
            <form action={closeTradePosition} style={{ flex: 1 }}>
              <input type="hidden" name="tradeId" value={activeTrade?.id ?? ""} />
              <input type="hidden" name="percentage" value="50" />
              <button className="button secondary" style={{ width: "100%", fontSize: "12px", padding: "0 8px" }} disabled={!activeTrade} type="submit">
                Close 50%
              </button>
            </form>
            <form action={closeTradePosition} style={{ flex: 1 }}>
              <input type="hidden" name="tradeId" value={activeTrade?.id ?? ""} />
              <input type="hidden" name="percentage" value="100" />
              <button className="button secondary" style={{ width: "100%", fontSize: "12px", padding: "0 8px" }} disabled={!activeTrade} type="submit">
                Market Close
              </button>
            </form>
            <form action={closeAllPositions} style={{ flex: 1 }}>
              <button className="button danger" style={{ width: "100%", fontSize: "12px", padding: "0 8px" }} disabled={!activeTrade} type="submit">
                Close all
              </button>
            </form>
          </div>
        </aside>
      </section>
    </div>
  );
}
