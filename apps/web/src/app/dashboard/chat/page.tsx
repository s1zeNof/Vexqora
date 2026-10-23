import { fetchRecentKlines } from "@crypto-bot/exchange";
import {
  createTradePreview,
  fetchTopUniverseOpportunities,
  generateNemotronOpportunity,
  type AISignalOpportunity,
  type HistoricalPatternMatch,
  type TradePreview
} from "@crypto-bot/trading";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { VexqoraLogo } from "../../../components/logo";
import { accountConnectionSchema, createAccountClient } from "../../../lib/account-client";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { formatTimeAgo } from "../../../lib/date";
import { formatPrice } from "../../../lib/format";
import { closeTradePosition } from "../actions";
import { scanMarketOpportunityAction } from "./actions";
import { LiveUniversePoller } from "./live-poller";
import { SignalCard } from "./signal-card";
import { SignalComposer } from "./signal-composer";

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
  searchParams: Promise<{ error?: string; queued?: string; executed?: string; tab?: string }>;
}) {
  const query = (await searchParams) ?? {};
  if (query?.tab === "pulse") {
    redirect("/dashboard/pulse");
  }

  const supabase = await createSupabaseServerClient();
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

  const [messagesResult, openTradesResult, riskResult] = account ? await Promise.all([
    supabase.from("chat_messages").select("id, role, kind, content, payload, created_at").eq("account_id", account.id).order("created_at", { ascending: false }).limit(40),
    supabase.from("trades").select("id, symbol, side, status, entry_avg, qty, leverage, sl, realized_pnl").eq("account_id", account.id).in("status", ["entry_open", "active"]).order("opened_at", { ascending: false }).limit(1),
    supabase.from("risk_settings").select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, allowed_symbols, kill_switch").eq("account_id", account.id).maybeSingle()
  ]) : [{ data: [] }, { data: [] }, { data: null }];

  const parsedMessages = z.array(messageSchema).safeParse(messagesResult.data ?? []);
  let messages = parsedMessages.success ? parsedMessages.data : [];

  // Proactive Seeding: auto-generate fresh setup if empty or stale
  const latestTimestamp = messages[0]?.created_at ? new Date(messages[0].created_at).getTime() : 0;
  const isFeedStale = !latestTimestamp || (Date.now() - latestTimestamp) > 5 * 60 * 1000;

  if (account && (messages.length === 0 || isFeedStale)) {
    try {
      const client = createAccountClient(account);
      const topOpps = await fetchTopUniverseOpportunities(2).catch(() => []);
      const bestOpp = topOpps[0] ?? { symbol: "BTCUSDT", lastPrice: 67200, change24hPct: 2.5, turnover24h: 1e9, anomalyType: "volume_breakout" as const };
      const activeSymbol = bestOpp.symbol;

      const [ticker, instrument, klines] = await Promise.all([
        client.getTicker(activeSymbol).catch(() => ({ symbol: activeSymbol, lastPrice: bestOpp.lastPrice })),
        client.getInstrument(activeSymbol),
        fetchRecentKlines(activeSymbol, "15", 15).catch(() => [])
      ]);
      const opp = await generateNemotronOpportunity(activeSymbol, ticker.lastPrice, { tickSize: instrument.tickSize, klines });
      const riskRow = riskResult.data as { risk_per_trade_pct?: number; max_leverage?: number; max_open_positions?: number; max_daily_loss_pct?: number; kill_switch?: boolean } | null;
      const preview = createTradePreview(opp.parsedSignal, instrument, {
        riskPerTradePct: Number(riskRow?.risk_per_trade_pct ?? 1),
        maxLeverage: Number(riskRow?.max_leverage ?? 5),
        maxOpenPositions: Number(riskRow?.max_open_positions ?? 3),
        maxDailyLossPct: Number(riskRow?.max_daily_loss_pct ?? 5),
        killSwitch: Boolean(riskRow?.kill_switch)
      }, {
        balance: balance ?? 20000,
        marketPrice: ticker.lastPrice,
        openPositions: 0,
        dailyPnl: 0
      });

      const { data: storedSignal } = await supabase.from("signals").insert({
        account_id: account.id,
        raw_text: opp.rawSignal,
        parsed: preview,
        source: "nemotron_autonomous",
        status: "preview"
      }).select("id").maybeSingle();

      const parsedSignalId = z.object({ id: z.string() }).safeParse(storedSignal);
      const signalId: string | null = parsedSignalId.success ? parsedSignalId.data.id : null;

      const { data: newMsg } = await supabase.from("chat_messages").insert({
        account_id: account.id,
        role: "assistant",
        kind: "ai_signal",
        content: `Nemotron AI Setup: ${opp.symbol} ${opp.side.toUpperCase()} · ${opp.strategy}`,
        payload: {
          opportunity: opp,
          preview,
          signalId,
          rawSignal: opp.rawSignal
        }
      }).select("id, role, kind, content, payload, created_at").maybeSingle();

      if (newMsg) {
        messages = [messageSchema.parse(newMsg), ...messages];
      }
    } catch {
      // Continue without auto-seeding
    }
  }

  // Active Trade Details
  const parsedTrades = z.array(tradeSchema).safeParse(openTradesResult.data ?? []);
  const activeTrade = parsedTrades.success && parsedTrades.data.length ? parsedTrades.data[0] : null;

  let activeTradeMarkPrice: number | null = null;
  if (account && activeTrade) {
    try {
      const client = createAccountClient(account);
      const tTicker = await client.getTicker(activeTrade.symbol).catch(() => null);
      activeTradeMarkPrice = tTicker?.lastPrice ?? null;
    } catch {
      // fallback
    }
  }

  const currentMark = activeTradeMarkPrice ?? activeTrade?.entry_avg ?? 0;
  const pnlDiff = activeTrade ? (activeTrade.side === "long" ? currentMark - (activeTrade.entry_avg ?? currentMark) : (activeTrade.entry_avg ?? currentMark) - currentMark) : 0;
  const unrealizedPnl = activeTrade ? pnlDiff * (activeTrade.qty ?? 0) : 0;

  const signalMessages = messages.filter(m => m.kind !== "market_pulse");

  return (
    <div className="chat-container">
      {/* Toast Notifications */}
      {query.error && <p className="notice error">{query.error}</p>}
      {query.executed && <p className="notice success">Signal executed! Position opened on exchange.</p>}
      {query.queued && <p className="notice success">Signal queued for execution.</p>}

      {/* Active Position Banner (OKX style) */}
      {activeTrade && (
        <div
          className="cd"
          style={{
            padding: "14px 18px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            border: "1px solid #42F5B944"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "4px", background: "#42F5B9", display: "inline-block" }} />
            <b style={{ font: "700 15px Inter", color: "#FFFFFF" }}>{activeTrade.symbol}</b>
            <span className={`tg ${activeTrade.side === "long" ? "lg" : "sh"}`}>
              {activeTrade.side.toUpperCase()} {activeTrade.leverage ?? 5}x
            </span>
            <span className="lb">Entry: {formatPrice(activeTrade.entry_avg ?? 0)}</span>
            <span className="lb">Mark: {formatPrice(currentMark)}</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginLeft: "auto" }}>
            <span
              style={{
                font: "700 15px Inter",
                fontVariantNumeric: "tabular-nums",
                color: unrealizedPnl >= 0 ? "#42F5B9" : "#FF5A6E"
              }}
            >
              {unrealizedPnl >= 0 ? "+" : ""}{unrealizedPnl.toFixed(2)} USDT
            </span>

            <Link
              href={`/dashboard/signal/${activeTrade.symbol}`}
              className="bt"
              style={{ height: "30px", padding: "0 10px", fontSize: "12px" }}
            >
              Open chart →
            </Link>

            <form action={closeTradePosition}>
              <input type="hidden" name="tradeId" value={activeTrade.id} />
              <button
                type="submit"
                className="bt dn"
                style={{ height: "30px", padding: "0 10px", fontSize: "12px" }}
              >
                Close
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Universe Scanner Status */}
      <LiveUniversePoller />

      {/* Quick Pair Scan Pills */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
        <span className="lb" style={{ marginRight: "4px" }}>Quick Scan:</span>
        {["BTCUSDT", "ETHUSDT", "SOLUSDT", "SUIUSDT", "PEPEUSDT", "DOGEUSDT"].map((sym) => (
          <form key={sym} action={scanMarketOpportunityAction} style={{ display: "inline-flex" }}>
            <input type="hidden" name="symbol" value={sym} />
            <button
              type="submit"
              className="tg gy"
              style={{ cursor: "pointer", border: "1px solid #262626" }}
            >
              {sym.replace("USDT", "")}
            </button>
          </form>
        ))}
      </div>

      {/* Signal Stream */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {signalMessages.length === 0 ? (
          <div className="cd" style={{ padding: "40px 20px", textAlign: "center", color: "#9A9A9A" }}>
            <VexqoraLogo size={36} />
            <div style={{ font: "600 16px Inter", color: "#FFFFFF", marginTop: "12px" }}>Vexqora Signal Stream</div>
            <p className="lb" style={{ marginTop: "6px" }}>
              Scanning Bybit linear setups. Click a pair above or type a signal in the composer below.
            </p>
          </div>
        ) : (
          signalMessages.map((message) => {
            const payload = (message.payload && typeof message.payload === "object" ? message.payload : {}) as Record<string, unknown>;
            const opp = payload.opportunity as AISignalOpportunity | undefined;
            const preview = payload.preview as TradePreview | undefined;
            const signalId = typeof payload.signalId === "string" ? payload.signalId : null;
            const rawSignal = typeof payload.rawSignal === "string" ? payload.rawSignal : null;
            const hist = payload.historicalMatch as HistoricalPatternMatch | undefined;

            if ((message.kind === "ai_signal" && opp) || message.kind === "signal_preview") {
              return (
                <SignalCard
                  key={message.id}
                  messageId={message.id}
                  createdAt={message.created_at}
                  opp={opp}
                  preview={preview}
                  signalId={signalId}
                  rawSignal={rawSignal}
                  hist={hist}
                />
              );
            }

            return (
              <article
                key={message.id}
                className={`message ${message.role}`}
                style={{ width: "100%", maxWidth: "100%" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <small style={{ color: "#9A9A9A" }}>{String(message.kind || "").replaceAll("_", " ")}</small>
                  <small style={{ color: "#9A9A9A", fontVariantNumeric: "tabular-nums" }}>
                    {formatTimeAgo(message.created_at)}
                  </small>
                </div>
                <p style={{ color: "#FFFFFF" }}>{message.content}</p>
              </article>
            );
          })
        )}
      </div>

      {/* Signal Composer */}
      {account ? (
        <SignalComposer />
      ) : (
        <p className="notice error">
          Workspace is initializing. Visit Accounts to verify your connection.
        </p>
      )}
    </div>
  );
}
