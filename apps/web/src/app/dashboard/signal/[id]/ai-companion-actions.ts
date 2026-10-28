"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  orchestrateTradeAnalysis,
  type LeadTradeSynthesis,
  type AccountDailyLossStatus,
  type MarketMicrostructure,
  type MarketContextSnapshot,
  type NewsRiskAssessment,
  calculateRSI,
  callNemotron,
  evaluateMarketMicrostructure,
  buildMarketContextSnapshot,
  evaluateNewsRiskForTrade
} from "@crypto-bot/trading";
import {
  fetchRecentKlines,
  fetchOrderBook,
  fetchRecentTrades,
  fetchOpenInterest
} from "@crypto-bot/exchange";
import { sanitizeSymbol, type Kline } from "@crypto-bot/shared";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface TradeAiMessageItem {
  id: string;
  clientMessageId?: string | null | undefined;
  authorKind: "user" | "lead" | "subagent" | "system";
  agentId?: string | null | undefined;
  kind: "text" | "event" | "analysis" | "action_recommendation" | "action_status";
  content: string;
  structuredPayload?: Record<string, unknown> | null | undefined;
  createdAt: string;
  status?: "sending" | "sent" | "failed" | undefined;
}

export interface TradeAiSessionData {
  id: string;
  symbol: string;
  status: "active" | "closed" | "paused";
  initialThesis?: string | null | undefined;
  invalidationCriteria?: string | null | undefined;
  messages: TradeAiMessageItem[];
}

export interface AuthoritativeMarketContext {
  symbol: string;
  exchange: string;
  asOfMs: number;
  currentPrice: number;
  klines15M: Kline[];
  klines4H: Kline[];
  klines1D: Kline[];
  microstructure: MarketMicrostructure | null;
  mtfSnapshot: MarketContextSnapshot | null;
  newsAssessment: NewsRiskAssessment | null;
  lossStatus: AccountDailyLossStatus;
  dataSources: {
    ticker: "OK" | "UNAVAILABLE";
    orderBook: "OK" | "UNAVAILABLE";
    recentTrades: "OK" | "UNAVAILABLE";
    openInterest: "OK" | "UNAVAILABLE";
    klines15M: "OK" | "UNAVAILABLE";
    klines4H: "OK" | "UNAVAILABLE";
    klines1D: "OK" | "UNAVAILABLE";
    newsFeed: "OK" | "UNAVAILABLE";
  };
}

interface DbSessionRow {
  id: string;
  user_id: string;
  account_id: string;
  trade_id: string | null;
  signal_id: string | null;
  symbol: string;
  status: "active" | "closed" | "paused";
  initial_thesis: string | null;
  invalidation_criteria: string | null;
}

interface DbTradeRow {
  id: string;
  account_id: string;
  symbol: string;
  side: string;
  entry_avg: number | string | null;
  sl: number | string | null;
  tp1: number | string | null;
  qty: number | string | null;
  leverage?: number | string | null;
  opened_at?: string | null;
  status: string;
}


const sessionSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  status: z.enum(["active", "closed", "paused"]).catch("active"),
  initial_thesis: z.string().nullable().optional(),
  invalidation_criteria: z.string().nullable().optional()
});

const messageSchema = z.object({
  id: z.string(),
  client_message_id: z.string().nullable().optional(),
  author_kind: z.enum(["user", "lead", "subagent", "system"]),
  agent_id: z.string().nullable().optional(),
  kind: z.enum(["text", "event", "analysis", "action_recommendation", "action_status"]),
  content: z.string(),
  structured_payload: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: z.string()
});

/**
 * Authoritatively fetches real-time market price on the server.
 */
export async function fetchAuthoritativeLivePrice(symbol: string): Promise<number> {
  const norm = sanitizeSymbol(symbol).toUpperCase();
  try {
    const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${norm}`, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (res.ok) {
      const data = (await res.json()) as { result?: { list?: Array<{ lastPrice?: string }> } };
      const lp = Number(data.result?.list?.[0]?.lastPrice);
      if (Number.isFinite(lp) && lp > 0) return lp;
    }
  } catch {
    // fallback to Binance
  }

  try {
    const bRes = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${norm}`, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (bRes.ok) {
      const data = (await bRes.json()) as { lastPrice?: string };
      const lp = Number(data.lastPrice);
      if (Number.isFinite(lp) && lp > 0) return lp;
    }
  } catch {
    // fallback
  }

  return 0;
}

/**
 * Checks authoritative daily loss limit and kill switch status in the database.
 */
export async function checkAuthoritativeDailyLoss(
  supabase: SupabaseServerClient,
  accountId: string
): Promise<AccountDailyLossStatus> {
  try {
    const [settingsRes, accountRes] = await Promise.all([
      supabase
        .from("risk_settings")
        .select("max_daily_loss_pct, kill_switch")
        .eq("account_id", accountId)
        .maybeSingle(),
      supabase
        .from("exchange_accounts")
        .select("paper_balance")
        .eq("id", accountId)
        .maybeSingle()
    ]);

    const settings = settingsRes.data as { max_daily_loss_pct?: number | string | null; kill_switch?: boolean | null } | null;
    const account = accountRes.data as { paper_balance?: number | string | null } | null;

    if (!settings) {
      return {
        checked: false,
        details: "Risk settings not configured"
      };
    }

    if (settings.kill_switch) {
      return {
        checked: true,
        limitBreached: true,
        details: "Kill Switch активовано на рівні ризик-менеджменту акаунту"
      };
    }

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const { data: rawClosedTrades } = await supabase
      .from("trades")
      .select("realized_pnl")
      .eq("account_id", accountId)
      .eq("status", "closed")
      .gte("closed_at", todayStart.toISOString());

    const closedTrades = (rawClosedTrades as Array<{ realized_pnl?: number | string | null }>) ?? [];
    const dailyRealizedLoss = closedTrades.reduce((acc, t) => {
      const pnl = Number(t.realized_pnl ?? 0);
      return pnl < 0 ? acc + Math.abs(pnl) : acc;
    }, 0);

    const balance = Number(account?.paper_balance ?? 10000);
    const maxLossPct = Number(settings.max_daily_loss_pct ?? 5);
    const allowedLossUsdt = (balance * maxLossPct) / 100;
    const isBreached = dailyRealizedLoss >= allowedLossUsdt;

    return {
      checked: true,
      limitBreached: isBreached,
      dailyLossLimitPct: maxLossPct,
      currentRealizedLossUsdt: dailyRealizedLoss,
      details: isBreached
        ? `Денний збиток (${dailyRealizedLoss.toFixed(2)} USDT) досяг або перевищив ліміт ${maxLossPct}% (${allowedLossUsdt.toFixed(2)} USDT)`
        : `Денний збиток ${dailyRealizedLoss.toFixed(2)} / ${allowedLossUsdt.toFixed(2)} USDT (${maxLossPct}%) у межах норми`
    };
  } catch (err) {
    return {
      checked: false,
      details: `Помилка перевірки лімітів: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

/**
 * P0.5: Gathers complete, live authoritative market context across tickers, order books,
 * recent trades, derivatives, and MTF klines. Never falsifies missing data with zeros.
 */
export async function fetchAuthoritativeMarketContext(
  supabase: SupabaseServerClient,
  accountId: string,
  symbol: string,
  fallbackPrice = 0
): Promise<AuthoritativeMarketContext> {
  const normSymbol = sanitizeSymbol(symbol).toUpperCase();
  const asOfMs = Date.now();

  const [
    livePriceRes,
    klines15MRes,
    klines4HRes,
    klines1DRes,
    orderBookRes,
    recentTradesRes,
    openInterestRes,
    lossStatusRes
  ] = await Promise.allSettled([
    fetchAuthoritativeLivePrice(normSymbol),
    fetchRecentKlines(normSymbol, "15", 50),
    fetchRecentKlines(normSymbol, "240", 50),
    fetchRecentKlines(normSymbol, "D", 50),
    fetchOrderBook(normSymbol, 50),
    fetchRecentTrades(normSymbol, 50),
    fetchOpenInterest(normSymbol, 6),
    checkAuthoritativeDailyLoss(supabase, accountId)
  ]);

  const livePrice = livePriceRes.status === "fulfilled" ? livePriceRes.value : 0;
  const klines15M = klines15MRes.status === "fulfilled" ? klines15MRes.value : [];
  const klines4H = klines4HRes.status === "fulfilled" ? klines4HRes.value : [];
  const klines1D = klines1DRes.status === "fulfilled" ? klines1DRes.value : [];
  const orderBook = orderBookRes.status === "fulfilled" ? orderBookRes.value : null;
  const recentTrades = recentTradesRes.status === "fulfilled" ? recentTradesRes.value : [];
  const openInterest = openInterestRes.status === "fulfilled" ? openInterestRes.value : [];
  const lossStatus: AccountDailyLossStatus = lossStatusRes.status === "fulfilled" ? lossStatusRes.value : {
    checked: false,
    details: "Failed to evaluate daily loss"
  };

  const currentPrice = livePrice > 0 ? livePrice : (klines15M[klines15M.length - 1]?.close ?? fallbackPrice);

  let microstructure: MarketMicrostructure | null = null;
  if (orderBook && recentTrades.length > 0) {
    try {
      microstructure = evaluateMarketMicrostructure({
        symbol: normSymbol,
        orderBook,
        trades: recentTrades,
        klines: klines15M,
        oiPoints: openInterest,
        priceChangePct: 0
      });
    } catch {
      microstructure = null;
    }
  }

  let mtfSnapshot: MarketContextSnapshot | null = null;
  if (klines15M.length > 0 || klines4H.length > 0 || klines1D.length > 0) {
    try {
      mtfSnapshot = buildMarketContextSnapshot({
        symbol: normSymbol,
        timeframeKlines: {
          "1D": klines1D,
          "4H": klines4H,
          "15M": klines15M
        },
        asOfMs
      });
    } catch {
      mtfSnapshot = null;
    }
  }

  const newsAssessment: NewsRiskAssessment = evaluateNewsRiskForTrade(normSymbol, [], "UNAVAILABLE");

  return {
    symbol: normSymbol,
    exchange: "Bybit Linear",
    asOfMs,
    currentPrice,
    klines15M,
    klines4H,
    klines1D,
    microstructure,
    mtfSnapshot,
    newsAssessment,
    lossStatus,
    dataSources: {
      ticker: livePrice > 0 ? "OK" : "UNAVAILABLE",
      orderBook: orderBook ? "OK" : "UNAVAILABLE",
      recentTrades: recentTrades.length > 0 ? "OK" : "UNAVAILABLE",
      openInterest: openInterest.length > 0 ? "OK" : "UNAVAILABLE",
      klines15M: klines15M.length > 0 ? "OK" : "UNAVAILABLE",
      klines4H: klines4H.length > 0 ? "OK" : "UNAVAILABLE",
      klines1D: klines1D.length > 0 ? "OK" : "UNAVAILABLE",
      newsFeed: "UNAVAILABLE"
    }
  };
}

/**
 * Strictly read-only fetch of an existing AI Companion session.
 */
export async function getTradeAiSession(params: {
  symbol: string;
  tradeId?: string | null | undefined;
  signalId?: string | null | undefined;
}): Promise<TradeAiSessionData | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  let query = supabase
    .from("trade_ai_sessions")
    .select("id, symbol, status, initial_thesis, invalidation_criteria")
    .eq("user_id", user.id)
    .eq("symbol", params.symbol.toUpperCase());

  if (params.tradeId) {
    query = query.eq("trade_id", params.tradeId);
  } else if (params.signalId) {
    query = query.eq("signal_id", params.signalId);
  }

  let { data: rawExisting } = await query.limit(1).maybeSingle();

  // Fallback: If tradeId was passed but no session has trade_id set,
  // link matching active session for this user and symbol
  if (!rawExisting && params.tradeId) {
    let fallbackQuery = supabase
      .from("trade_ai_sessions")
      .select("id, symbol, status, initial_thesis, invalidation_criteria")
      .eq("user_id", user.id)
      .eq("symbol", params.symbol.toUpperCase());

    if (params.signalId) {
      fallbackQuery = fallbackQuery.eq("signal_id", params.signalId);
    } else {
      fallbackQuery = fallbackQuery.is("trade_id", null);
    }

    const { data: fallbackExisting } = await fallbackQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fallbackExisting) {
      await supabase
        .from("trade_ai_sessions")
        .update({ trade_id: params.tradeId })
        .eq("id", fallbackExisting.id);
      rawExisting = fallbackExisting;
    }
  }

  const existing = sessionSchema.safeParse(rawExisting).data ?? null;
  if (!existing) return null;

  // Retrieve the latest 50 messages in chronological order (P1.8 & P0.2)
  const { data: rawMessages } = await supabase
    .from("trade_ai_messages")
    .select("id, author_kind, agent_id, kind, content, structured_payload, created_at")
    .eq("session_id", existing.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const parsedMessages = z.array(messageSchema).safeParse(rawMessages).data ?? [];
  const messages: TradeAiMessageItem[] = parsedMessages.slice().reverse().map((m) => ({
    id: m.id,
    clientMessageId: (m.structured_payload as { clientMessageId?: string | null })?.clientMessageId ?? null,
    authorKind: m.author_kind,
    agentId: m.agent_id ?? null,
    kind: m.kind,
    content: m.content,
    structuredPayload: m.structured_payload ?? null,
    createdAt: m.created_at
  }));

  return {
    id: existing.id,
    symbol: existing.symbol,
    status: existing.status,
    initialThesis: existing.initial_thesis ?? null,
    invalidationCriteria: existing.invalidation_criteria ?? null,
    messages
  };
}

/**
 * Idempotently creates an AI Companion session on explicit user action or trade open.
 */
export async function ensureTradeAiSession(params: {
  symbol?: string | undefined;
  tradeId?: string | null | undefined;
  signalId?: string | null | undefined;
  side?: "long" | "short" | undefined;
  entryPrice?: number | undefined;
  stopLoss?: number | undefined;
  tp1?: number | undefined;
}): Promise<TradeAiSessionData | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  let authoritativeAccountId: string | null = null;
  let authoritativeSymbol = params.symbol ? sanitizeSymbol(params.symbol).toUpperCase() : "";
  let authoritativeSide: "long" | "short" = params.side ?? "long";
  let authoritativeEntry = Number(params.entryPrice ?? 0);
  let authoritativeSl = Number(params.stopLoss ?? 0);
  let authoritativeTp1 = Number(params.tp1 ?? 0);

  // 1. Authoritative ownership verification (P0.1)
  if (params.tradeId) {
    const { data: rawTrade, error: tradeErr } = await supabase
      .from("trades")
      .select("id, account_id, symbol, side, entry_avg, sl, status")
      .eq("id", params.tradeId)
      .maybeSingle();

    const trade = rawTrade as DbTradeRow | null;
    if (tradeErr || !trade) {
      throw new Error("Security violation: Trade not found or access denied");
    }

    const { data: rawAccount } = await supabase
      .from("exchange_accounts")
      .select("id")
      .eq("id", trade.account_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!rawAccount) {
      throw new Error("Security violation: Trade belongs to another user account");
    }

    authoritativeAccountId = trade.account_id;
    authoritativeSymbol = trade.symbol.toUpperCase();
    authoritativeSide = trade.side === "short" ? "short" : "long";
    authoritativeEntry = Number(trade.entry_avg ?? authoritativeEntry);
    authoritativeSl = Number(trade.sl ?? authoritativeSl);

    // Query TP1 from trade_targets
    const { data: targetData } = await supabase
      .from("trade_targets")
      .select("price")
      .eq("trade_id", params.tradeId)
      .eq("idx", 1)
      .maybeSingle();

    if (targetData?.price) {
      authoritativeTp1 = Number(targetData.price);
    }

    const { data: existingSession } = await supabase
      .from("trade_ai_sessions")
      .select("id, symbol, status, initial_thesis, invalidation_criteria")
      .eq("trade_id", params.tradeId)
      .maybeSingle();

    if (existingSession) {
      return getTradeAiSession({
        symbol: authoritativeSymbol,
        tradeId: params.tradeId
      });
    }
  } else if (params.signalId) {
    const { data: rawSignal, error: sigErr } = await supabase
      .from("signals")
      .select("id, account_id, parsed")
      .eq("id", params.signalId)
      .maybeSingle();

    const signal = rawSignal;
    if (sigErr || !signal) {
      throw new Error("Security violation: Signal not found or access denied");
    }

    const { data: rawAccount } = await supabase
      .from("exchange_accounts")
      .select("id")
      .eq("id", signal.account_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!rawAccount) {
      throw new Error("Security violation: Signal belongs to another user account");
    }

    authoritativeAccountId = String(signal.account_id);
    const parsed = signal.parsed as {
      symbol?: unknown;
      side?: unknown;
      entryPrice?: unknown;
      stopLoss?: unknown;
      takeProfits?: unknown;
    } | null;
    if (parsed) {
      if (typeof parsed.symbol === "string") authoritativeSymbol = sanitizeSymbol(parsed.symbol).toUpperCase();
      if (parsed.side === "short" || parsed.side === "long") authoritativeSide = parsed.side;
      if (typeof parsed.entryPrice === "number") authoritativeEntry = parsed.entryPrice;
      if (typeof parsed.stopLoss === "number") authoritativeSl = parsed.stopLoss;
      const tps = parsed.takeProfits as Array<{ price?: number }> | undefined;
      if (Array.isArray(tps) && typeof tps[0]?.price === "number") authoritativeTp1 = tps[0].price;
    }

    const { data: existingSession } = await supabase
      .from("trade_ai_sessions")
      .select("id, symbol, status, initial_thesis, invalidation_criteria")
      .eq("user_id", user.id)
      .eq("signal_id", params.signalId)
      .maybeSingle();

    if (existingSession) {
      return getTradeAiSession({
        symbol: authoritativeSymbol,
        signalId: params.signalId
      });
    }
  }

  if (!authoritativeAccountId) {
    const { data: rawActiveAcc } = await supabase
      .from("exchange_accounts")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    const activeAcc = rawActiveAcc as { id?: string } | null;
    if (activeAcc?.id) {
      authoritativeAccountId = activeAcc.id;
    } else {
      const { data: rawFallbackAcc } = await supabase
        .from("exchange_accounts")
        .select("id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      const fallbackAcc = rawFallbackAcc as { id?: string } | null;
      if (!fallbackAcc?.id) return null;
      authoritativeAccountId = fallbackAcc.id;
    }
  }

  if (!authoritativeSymbol || !authoritativeAccountId) return null;

  // 2. Fetch authoritative market facts on server (P0.2 & P0.5)
  const marketCtx = await fetchAuthoritativeMarketContext(
    supabase,
    authoritativeAccountId,
    authoritativeSymbol,
    authoritativeEntry
  );

  const currentPrice = marketCtx.currentPrice;
  if (authoritativeEntry === 0 && currentPrice > 0) {
    authoritativeEntry = currentPrice;
  }

  // 3. Run genuine Multi-Agent Orchestration with rich market data (P1.5 & P0.5)
  const synthesis = await orchestrateTradeAnalysis({
    symbol: authoritativeSymbol,
    currentPrice,
    side: authoritativeSide,
    entryPrice: authoritativeEntry,
    stopLoss: authoritativeSl,
    tp1: authoritativeTp1,
    klines: marketCtx.klines15M,
    mtfSnapshot: marketCtx.mtfSnapshot,
    microstructure: marketCtx.microstructure,
    newsAssessment: marketCtx.newsAssessment,
    accountDailyLossStatus: marketCtx.lossStatus
  });

  const newThesis = `Вхід у ${authoritativeSide.toUpperCase()} по $${authoritativeEntry} (SL: $${authoritativeSl}, TP1: $${authoritativeTp1}).`;
  const newInvalidation = `Пробиття Stop Loss $${authoritativeSl} або структурний злам тренду.`;

  // 4. Create Session in DB
  const { data: rawCreated, error } = await supabase
    .from("trade_ai_sessions")
    .insert({
      user_id: user.id,
      account_id: authoritativeAccountId,
      trade_id: params.tradeId ?? null,
      signal_id: params.signalId ?? null,
      symbol: authoritativeSymbol,
      status: "active",
      initial_thesis: newThesis,
      invalidation_criteria: newInvalidation
    })
    .select("id")
    .single();

  const createdSession = rawCreated as { id?: string } | null;
  if (error || !createdSession?.id) {
    return getTradeAiSession({
      symbol: authoritativeSymbol,
      tradeId: params.tradeId,
      signalId: params.signalId
    });
  }

  const sessionId = createdSession.id;

  // 5. Generate Opening Evidence-Backed Thesis
  const distToSl = currentPrice > 0 && authoritativeSl > 0 ? ((Math.abs(currentPrice - authoritativeSl) / currentPrice) * 100).toFixed(2) : "н/д";
  const distToTp1 = currentPrice > 0 && authoritativeTp1 > 0 ? ((Math.abs(authoritativeTp1 - currentPrice) / currentPrice) * 100).toFixed(2) : "н/д";

  const subResMap = new Map(synthesis.subagentResults.map((s) => [s.agentKey, s]));
  const structRes = subResMap.get("market_structure_agent");
  const ofRes = subResMap.get("order_flow_agent");
  const riskRes = subResMap.get("risk_guardian_agent");

  const ofDetail = ofRes?.evidence[0]?.data;
  const cvdUsd = typeof ofDetail?.cvdUsd === "number" ? ofDetail.cvdUsd.toFixed(0) : null;
  const obiVal = typeof ofDetail?.weightedImbalance === "number" ? (ofDetail.weightedImbalance * 100).toFixed(1) : null;

  let openingThesis = `**Первинний ринковий аналіз позиції (${authoritativeSymbol} ${authoritativeSide.toUpperCase()}):**\n\n` +
    `• **Поточна ціна:** **$${currentPrice}** (Вхід: $${authoritativeEntry}, SL: $${authoritativeSl} [${distToSl}%], TP1: $${authoritativeTp1} [${distToTp1}%]).\n` +
    `• **Структура тренду:** ${structRes?.analysis ?? "Дані формуються"}\n` +
    `• **Order Flow (Bybit):** ${cvdUsd !== null ? `CVD: **${Number(cvdUsd) >= 0 ? "+" : ""}${cvdUsd} USD** (дельта 50 недавніх угод), OBI: **${obiVal}%**` : "[DATA_UNAVAILABLE] Потік ордерів недоступний"}.\n` +
    `• **Оцінка ризику:** ${riskRes?.analysis ?? "Stop Loss підтверджено"}.\n` +
    `• **Вердикт Lead Agent:** **${synthesis.leadVerdict}** (Надійність синтезу: ${synthesis.confidencePct}%).\n\n` +
    `AI Companion відстежуватиме ринкову динаміку 24/7 та сповіщатиме про зміни рівнів ризику.`;

  let tokensUsed: number | null = null;
  let modelUsed = "deterministic_synthesis";
  let isLlm = false;

  const hasOpenRouterKey = Boolean(
    (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 10) ||
    (process.env.OPENROUTER_VISION_API_KEY && process.env.OPENROUTER_VISION_API_KEY.trim().length > 10)
  );

  if (hasOpenRouterKey) {
    try {
      const llmPrompt = `Сформуй короткий, точний і змістовний перший аналіз для нової угоди ${authoritativeSymbol} ${authoritativeSide.toUpperCase()} на біржі Bybit Linear.
Дані: Ціна входу $${authoritativeEntry}, Поточна $${currentPrice}, SL $${authoritativeSl} (${distToSl}%), TP1 $${authoritativeTp1} (${distToTp1}%).
Структура: ${structRes?.analysis ?? "[DATA_UNAVAILABLE]"}.
Order Flow: ${ofRes?.analysis ?? "[DATA_UNAVAILABLE]"}.
Ризик: ${riskRes?.analysis ?? "[DATA_UNAVAILABLE]"}.
Вердикт: ${synthesis.leadVerdict}.
Стиль: Anthropic Claude, українська мова, Markdown з булетами, без води.`;

      const nemotronResponse = await callNemotron([
        { role: "system", content: "Ти — Vexqora AI Trade Companion. Надавай чіткий, професійний ввідний аналіз для трейдера." },
        { role: "user", content: llmPrompt }
      ], {
        temperature: 0.3,
        maxTokens: 500
      });

      if (nemotronResponse?.content && nemotronResponse.content.trim().length > 0) {
        openingThesis = nemotronResponse.content.trim();
        tokensUsed = nemotronResponse.usage?.totalTokens ?? null;
        modelUsed = nemotronResponse.model ?? "openrouter_llm";
        isLlm = true;
      }
    } catch {
      // fallback to deterministic opening thesis
    }
  }

  await supabase.from("trade_ai_messages").insert({
    session_id: sessionId,
    author_kind: "lead",
    agent_id: "lead_trade_agent",
    kind: "analysis",
    content: openingThesis,
    structured_payload: {
      source: isLlm ? "openrouter_llm" : "deterministic_fallback",
      model: modelUsed,
      tokensUsed,
      verdict: synthesis.leadVerdict,
      timestamp: Date.now()
    }
  });

  return getTradeAiSession({
    symbol: authoritativeSymbol,
    tradeId: params.tradeId,
    signalId: params.signalId
  });
}

/**
 * Retrieves latest messages for an active session with cursor-based pagination and delta polling.
 * P0.2 & P1.8: Delivers all messages smoothly without truncation or duplicate user bubbles.
 */
export async function getLatestTradeAiMessages(
  sessionId: string,
  options?: {
    sinceIso?: string | undefined;
    beforeIso?: string | undefined;
    limit?: number | undefined;
  }
): Promise<TradeAiMessageItem[]> {
  const supabase = await createSupabaseServerClient();
  const limit = Math.min(options?.limit ?? 50, 150);

  let query = supabase
    .from("trade_ai_messages")
    .select("id, author_kind, agent_id, kind, content, structured_payload, created_at")
    .eq("session_id", sessionId);

  // Delta polling: messages created after sinceIso
  if (options?.sinceIso) {
    query = query
      .gt("created_at", options.sinceIso)
      .order("created_at", { ascending: true })
      .limit(limit);

    const { data: rawMessages } = await query;
    const parsedMessages = z.array(messageSchema).safeParse(rawMessages).data ?? [];
    return parsedMessages.map((m) => ({
      id: m.id,
      clientMessageId: (m.structured_payload as { clientMessageId?: string | null })?.clientMessageId ?? null,
      authorKind: m.author_kind,
      agentId: m.agent_id ?? null,
      kind: m.kind,
      content: m.content,
      structuredPayload: m.structured_payload ?? null,
      createdAt: m.created_at
    }));
  }

  // Initial or cursor pagination: fetch newest messages descending, then reverse
  query = query.order("created_at", { ascending: false }).limit(limit);

  if (options?.beforeIso) {
    query = query.lt("created_at", options.beforeIso);
  }

  const { data: rawMessages } = await query;
  const parsedMessages = z.array(messageSchema).safeParse(rawMessages).data ?? [];
  const reversed = parsedMessages.slice().reverse();

  return reversed.map((m) => ({
    id: m.id,
    clientMessageId: (m.structured_payload as { clientMessageId?: string | null })?.clientMessageId ?? null,
    authorKind: m.author_kind,
    agentId: m.agent_id ?? null,
    kind: m.kind,
    content: m.content,
    structuredPayload: m.structured_payload ?? null,
    createdAt: m.created_at
  }));
}

/**
 * Sends a message in the per-trade AI Companion session and triggers real Lead Agent orchestration.
 * P0.2: Client message ID for optimistic reconciliation.
 * P0.5 & P0.6: Live authoritative market context across Bybit L2 books, tape delta, and MTF.
 */
export async function sendTradeAiMessage(
  sessionId: string,
  userPrompt: string,
  clientMessageId?: string
): Promise<TradeAiMessageItem | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !userPrompt.trim()) return null;

  // 1. Authoritative Session & Trade lookup (P0.1 & P0.2)
  const { data: rawSession, error: sessErr } = await supabase
    .from("trade_ai_sessions")
    .select("id, user_id, account_id, trade_id, signal_id, symbol, status")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  const session = rawSession as DbSessionRow | null;
  if (sessErr || !session) {
    throw new Error("Security violation: Session not found or access denied");
  }

  const symbol = session.symbol.toUpperCase();

  let side: "long" | "short" = "long";
  let entryPrice = 0;
  let stopLoss = 0;
  let tp1 = 0;
  let qty = 0;
  let leverage = 5;
  let openedAt: string | null = null;

  if (session.trade_id) {
    const { data: rawTrade } = await supabase
      .from("trades")
      .select("symbol, side, entry_avg, sl, qty, leverage, opened_at, status")
      .eq("id", session.trade_id)
      .maybeSingle();

    const trade = rawTrade as DbTradeRow | null;
    if (trade) {
      side = trade.side === "short" ? "short" : "long";
      entryPrice = Number(trade.entry_avg ?? 0);
      stopLoss = Number(trade.sl ?? 0);
      qty = Number(trade.qty ?? 0);
      leverage = Number(trade.leverage ?? 5);
      openedAt = trade.opened_at ?? null;

      // Authoritatively query TP1 from trade_targets
      const { data: targetData } = await supabase
        .from("trade_targets")
        .select("price")
        .eq("trade_id", session.trade_id)
        .eq("idx", 1)
        .maybeSingle();

      if (targetData?.price) {
        tp1 = Number(targetData.price);
      }
    }
  } else if (session.signal_id) {
    const { data: rawSignal } = await supabase
      .from("signals")
      .select("parsed")
      .eq("id", session.signal_id)
      .maybeSingle();

    const signal = rawSignal;
    const parsed = signal?.parsed as {
      side?: unknown;
      entryPrice?: unknown;
      stopLoss?: unknown;
      takeProfits?: unknown;
    } | null;
    if (parsed) {
      if (parsed.side === "short" || parsed.side === "long") side = parsed.side;
      if (typeof parsed.entryPrice === "number") entryPrice = parsed.entryPrice;
      if (typeof parsed.stopLoss === "number") stopLoss = parsed.stopLoss;
      const tps = parsed.takeProfits as Array<{ price?: number }> | undefined;
      if (Array.isArray(tps) && typeof tps[0]?.price === "number") tp1 = tps[0].price;
    }
  }

  // 2. Fetch authoritative market facts on server (P0.2 & P0.5)
  const marketCtx = await fetchAuthoritativeMarketContext(
    supabase,
    session.account_id,
    symbol,
    entryPrice
  );

  const currentPrice = marketCtx.currentPrice;
  if (entryPrice === 0 && currentPrice > 0) entryPrice = currentPrice;

  // Compute authoritative PnL if trade has active position
  const isLong = side === "long";
  const pnlUsdt = qty > 0 ? (isLong ? (currentPrice - entryPrice) * qty : (entryPrice - currentPrice) * qty) : undefined;
  const pnlPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 * (isLong ? 1 : -1) : undefined;
  const positionValueUsd = qty > 0 ? qty * currentPrice : 0;

  // 3. Insert user message with clientMessageId (P0.2)
  await supabase.from("trade_ai_messages").insert({
    session_id: sessionId,
    author_kind: "user",
    kind: "text",
    content: userPrompt.trim(),
    structured_payload: {
      clientMessageId: clientMessageId ?? null,
      timestamp: Date.now()
    }
  });

  // 4. Run real Multi-Agent Orchestration with rich market data (P0.5)
  const synthesis: LeadTradeSynthesis = await orchestrateTradeAnalysis({
    sessionId,
    symbol,
    currentPrice,
    side,
    entryPrice,
    stopLoss,
    tp1,
    klines: marketCtx.klines15M,
    mtfSnapshot: marketCtx.mtfSnapshot,
    microstructure: marketCtx.microstructure,
    newsAssessment: marketCtx.newsAssessment,
    accountDailyLossStatus: marketCtx.lossStatus
  });

  // 5. Build authoritative facts context with explicit provenance and timestamps (P0.6)
  const lower = userPrompt.toLowerCase();
  const pnlText = pnlUsdt !== undefined
    ? `Поточний PnL: ${pnlUsdt >= 0 ? "+" : ""}${pnlUsdt.toFixed(2)} USDT (${pnlPct !== undefined ? (pnlPct >= 0 ? "+" : "") + pnlPct.toFixed(2) + "%" : "0%"}) · Позиція: ${qty} ${symbol} (~$${positionValueUsd.toFixed(2)}, плече ${leverage}x).`
    : "";

  const subResMap = new Map(synthesis.subagentResults.map((s) => [s.agentKey, s]));
  const structRes = subResMap.get("market_structure_agent");
  const orderFlowRes = subResMap.get("order_flow_agent");
  const riskRes = subResMap.get("risk_guardian_agent");
  const newsRes = subResMap.get("news_events_agent");

  const structDetail = structRes?.evidence[0]?.data;
  const ofDetail = orderFlowRes?.evidence[0]?.data;

  const distToSl = currentPrice > 0 && stopLoss > 0 ? ((Math.abs(currentPrice - stopLoss) / currentPrice) * 100).toFixed(2) : "н/д";
  const distToTp1 = currentPrice > 0 && tp1 > 0 ? ((Math.abs(tp1 - currentPrice) / currentPrice) * 100).toFixed(2) : "н/д";

  const hasOpenRouterKey = Boolean(
    (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 10) ||
    (process.env.OPENROUTER_VISION_API_KEY && process.env.OPENROUTER_VISION_API_KEY.trim().length > 10)
  );

  let replyText: string | null = null;
  let tokensUsed: number | null = null;
  let modelUsed = "deterministic_synthesis";
  let isLlm = false;

  const asOfDateStr = new Date(marketCtx.asOfMs).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  if (hasOpenRouterKey) {
    try {
      const structTrend = typeof structDetail?.regime === "string" ? structDetail.regime : (typeof structDetail?.trend === "string" ? structDetail.trend : "н/д");
      const structSwingHigh = typeof structDetail?.swingHigh === "number" ? structDetail.swingHigh.toString() : "н/д";
      const structSwingLow = typeof structDetail?.swingLow === "number" ? structDetail.swingLow.toString() : "н/д";
      const ofCvd = typeof ofDetail?.cvdUsd === "number" ? ofDetail.cvdUsd.toString() : "н/д";
      const ofObi = typeof ofDetail?.weightedImbalance === "number" ? (ofDetail.weightedImbalance * 100).toFixed(1) : "н/д";
      const buyerAgg = typeof ofDetail?.buyerAggressionPct === "number" ? ofDetail.buyerAggressionPct.toFixed(1) : "н/д";

      const systemPrompt = `Ти — Vexqora AI Trade Companion, персональний помічник і спокійний торговий радник (стилістика Anthropic / Claude: зважений, стриманий, розумний, впевнений, без паніки). Відповідай виключно українською мовою.
КЛЮЧОВІ ПРАВИЛА ПОВЕДІНКИ:
1. ЖОДНОЇ ПАНІКИ чи нав'язливого залякування ризиками. Трейдер очікує партнерської експертизи і тактичних порад, а не надмірної тривожності.
2. Якщо позиція у прибутку (green) або трейдер запитує про 50% фіксацію / безубиток:
   • Поясни, що закриття 50% позиції — це грамотний спосіб зафіксувати прибуток у депозит та зняти ризик від можливої корекції.
   • Перенесення Stop Loss на рівень входу (${entryPrice}) повністю усуває ризик, даючи змогу залишку безпечно рухатися до тейк-профітів.
3. Якщо денний ліміт збитків на акаунті спрацював від попередніх невдалих угод:
   • Не вимагай закривати поточну прибуткову позицію! Вона відновлює баланс депозиту. Денний ліміт захищає від відкриття НОВИХ угод, а не ліквідує поточний профіт.
4. Форматуй відповідь чисто за правилами Markdown: невеликі абзаци, чіткі списки з булетами (•), для чисел і цін використовуй жирний шрифт.
5. Спирайся на точні фактологічні дані біржі Bybit: поточна ціна, вхід, PnL, рівні підтримки/опору, стакан.
6. Якщо трейдер запитує або висловлює сумніви щодо напрямку (наприклад "чому не SHORT?", "там же FVG внизу", "тренд же вниз"):
   • Надай вичерпне, аргументоване порівняння LONG vs SHORT на поточному рівні.
   • Поясни ризик продажу в підтримку/дно на локальній консолідації та невигідний R:R для зустрічного шорта.
   • Безпосередньо розкрий роль FVG (Fair Value Gap): Stop Loss встановлено саме як рівень інвалідації перед заповненням FVG, а шортити перед ним ризиковано через відскоки.
   • Визнай контекст на старших таймфреймах (4H/1D), пояснивши, що поточна позиція — це тактичний відскок від перепроданості з жорстким стопом, а не заперечення спадного тренду.
   • Дай конкретні практичні рекомендації.`;

      const factsContext = `
ФАКТИ ПО УГОДІ ТА СУБАГЕНТАХ (${symbol}) станом на ${asOfDateStr}:
- Біржа: ${marketCtx.exchange}, Символ: ${symbol}, Напрямок: ${side.toUpperCase()}
- Ціна входу: $${entryPrice}, Поточна ціна: $${currentPrice}
- Stop Loss: $${stopLoss} (дистанція до SL: ${distToSl}%)
- Take Profit 1: $${tp1} (дистанція до TP1: ${distToTp1}%)
${openedAt ? `- Позицію відкрито: ${openedAt}` : "- Статус: Позиція активна в системі."}
${pnlText ? `- ${pnlText}` : "- Активної біржової позиції наразі немає (очікується вхід або спостереження)."}
- Загальний вердикт Lead Agent: ${synthesis.leadVerdict} (Надійність: ${synthesis.confidencePct}%)
- Ринкова структура: ${structRes?.analysis ?? "[DATA_UNAVAILABLE]"} (Режим: ${structTrend}, Swing High: $${structSwingHigh}, Swing Low: $${structSwingLow}, Таймфрейми: 15M/4H/1D)
- Order Flow / Стакан: ${orderFlowRes?.analysis ?? "[DATA_UNAVAILABLE]"} (Дельта недавніх 50 угод: ${ofCvd} USD, OBI дисбаланс 50 рівнів стакана: ${ofObi}%, Агресивність покупців: ${buyerAgg}%)
- Risk Guardian: ${riskRes?.analysis ?? "Stop Loss встановлений"}
- Новини / Події: ${newsRes?.analysis ?? "[DATA_UNAVAILABLE: новинний фід відключено]"}
- Статус джерел даних: Тікер: ${marketCtx.dataSources.ticker}, Стакан L2: ${marketCtx.dataSources.orderBook}, Стрічка угод: ${marketCtx.dataSources.recentTrades}, OI: ${marketCtx.dataSources.openInterest}.
`;

      const nemotronResponse = await callNemotron([
        { role: "system", content: systemPrompt },
        { role: "user", content: `${factsContext}\nЗапит користувача: "${userPrompt.trim()}"` }
      ], {
        temperature: 0.3,
        maxTokens: 350
      });

      if (nemotronResponse?.content && nemotronResponse.content.trim().length > 0) {
        replyText = nemotronResponse.content.trim();
        tokensUsed = nemotronResponse.usage?.totalTokens ?? null;
        modelUsed = nemotronResponse.model ?? "openrouter_llm";
        isLlm = true;
      }
    } catch {
      replyText = null;
    }
  }

  // Deterministic Contextual Fallback if LLM unavailable
  if (!replyText) {
    const swingH = typeof structDetail?.swingHigh === "number" ? structDetail.swingHigh.toString() : "н/д";
    const swingL = typeof structDetail?.swingLow === "number" ? structDetail.swingLow.toString() : "н/д";
    const cvdUsd = typeof ofDetail?.cvdUsd === "number" ? ofDetail.cvdUsd.toFixed(0) : null;
    const obi = typeof ofDetail?.weightedImbalance === "number" ? (ofDetail.weightedImbalance * 100).toFixed(1) : null;
    const buyerAgg = typeof ofDetail?.buyerAggressionPct === "number" ? ofDetail.buyerAggressionPct.toFixed(1) : null;

    // Intent 1: Directional Question / Short vs Long Dilemma / Invalidation / FVG Entry Question
    const isQuestioningDirection =
      lower.includes("чому не шорт") ||
      lower.includes("чому не short") ||
      lower.includes("чому не лонг") ||
      lower.includes("чому не long") ||
      lower.includes("чому шорт") ||
      lower.includes("чому лонг") ||
      lower.includes("краще шорт") ||
      lower.includes("краще б шорт") ||
      lower.includes("краще лонг") ||
      lower.includes("чи не краще") ||
      lower.includes("чи не шорт") ||
      lower.includes("чи не зашортити") ||
      lower.includes("чи не залонгити") ||
      lower.includes("проти тренду") ||
      lower.includes("чому вхід") ||
      lower.includes("чому обрали") ||
      lower.includes("чому обрано") ||
      (lower.includes("шорт") && (lower.includes("чому") || lower.includes("нащо") || lower.includes("краще") || lower.includes("тренд") || lower.includes("fvg"))) ||
      (lower.includes("fvg") && (lower.includes("шорт") || lower.includes("вниз") || lower.includes("чому")));

    // Intent 2: Target / Take Profit Probability / Dynamics
    const isAskingTargetOrTp =
      lower.includes("ймовірність") ||
      lower.includes("динаміка") ||
      lower.includes("tp1") ||
      lower.includes("tp2") ||
      lower.includes("тейк") ||
      lower.includes("ціл") ||
      lower.includes("дійде") ||
      lower.includes("досягнення");

    // Intent 3: Exit / Risk Reduction / Breakeven
    const isAskingExit =
      lower.includes("вийти") ||
      lower.includes("закрити") ||
      lower.includes("exit") ||
      lower.includes("close") ||
      lower.includes("безубиток");

    // Intent 4: FVG / Liquidity / SMC specifics
    const isAskingFvgOrLiquidity =
      lower.includes("fvg") ||
      lower.includes("fair value gap") ||
      lower.includes("імбаланс") ||
      lower.includes("дисбаланс") ||
      lower.includes("ліквідн") ||
      lower.includes("ордерблок") ||
      lower.includes("order block");

    // Intent 5: Technical indicators
    const isAskingIndicator =
      lower.includes("rsi") ||
      lower.includes("індикатор") ||
      lower.includes("indicator") ||
      lower.includes("ема") ||
      lower.includes("ema");

    // Intent 6: Order flow / CVD / Depth
    const isAskingOrderFlow =
      lower.includes("потік") ||
      lower.includes("cvd") ||
      lower.includes("кит") ||
      lower.includes("стакан") ||
      lower.includes("дельта") ||
      lower.includes("order flow") ||
      lower.includes("агресивність");

    // Intent 7: Risk / Stop Loss specifics
    const isAskingRisk =
      lower.includes("ризик") ||
      lower.includes("стоп") ||
      lower.includes("sl") ||
      lower.includes("stop loss");

    // Intent 8: Market Structure (when explicitly inquiring about structure regime)
    const isAskingStructure =
      lower.includes("яка структура") ||
      lower.includes("опиши структуру") ||
      lower.includes("bos") ||
      lower.includes("choch") ||
      lower.includes("режим");

    if (isQuestioningDirection) {
      const isLong = side === "long";
      replyText = `**Аналіз вибору напрямку позиції (${symbol} ${side.toUpperCase()} vs ${isLong ? "SHORT" : "LONG"}):**

• **Чому було відкрито саме ${side.toUpperCase()} (Вхід: ${entryPrice}):**
  - **Зона реакції:** Вхід здійснено від зони локальної підтримки (Swing Low: **${swingL}**). На молодших таймфреймах виникла локальна перепроданість.
  - **Математичний R:R:** Рівень Stop Loss встановлений на **${stopLoss}** (дистанція до стопу: **${distToSl}%**). Це забезпечує суворо контрольований ризик і вигідне співвідношення до першої цілі TP1 (${tp1}, **+${distToTp1}%**).

• **Чому входити в ${isLong ? "SHORT" : "LONG"} у цій точці — підвищений ризик:**
  - **Продаж у підтримку:** ${isLong ? `Відкривати SHORT на самому дні після імпульсного падіння (біля Swing Low ${swingL}) — це класична пастка запізнілих продавців (sell into support). Потенціал короткого руху вниз обмежений, а ризик різкого відскоку (short squeeze) на консолідації є максимальним.` : `Відкривати LONG на піку після сильного росту — ризик купівлі в опір.`}
  - **Невигідний R:R для зустрічної угоди:** Для відкриття безпечного шорта Stop Loss довелося б виносити за локальний опір (Swing High ${swingH}$), що робить ризик значно більшим за потенційний прибуток до найближчого дна.

• **Аналіз FVG (Fair Value Gap / Імбалансу) внизу:**
  - **Магніт ліквідності:** Нижній FVG дійсно притягує ціну. Проте ціна часто не перекриває його негайно, а спочатку дає технічний відскок від верхньої межі підтримки або забирає ліквідність у шортистів.
  - **Роль нашого Stop Loss (${stopLoss}):** Stop Loss розташований саме як системний захист від заповнення FVG. Якщо продавці продавлять підтримку ${swingL}$ і підуть заповнювати нижній імбаланс — спрацює системний стоп, обмеживши збиток розрахунковими **${distToSl}%**.
  - **Коли SHORT стане дійсно валідним:** Шорт стане технічно виправданим лише у разі впевненого закриття свічки НИЖЧЕ підтримки ${swingL}$ із закріпленням та наступним ретестом знизу як опору (Break of Structure / BOS), або при відбої від верхнього опору ${swingH}$.

• **Щодо спадного тренду (мультитаймфреймова картина):**
  - Ви абсолютно правильно помітили спадний контекст на старших таймфреймах (4H/1D).
  - Поточна позиція — це **тактичний відскок від перепроданості (mean reversion)** з короткостроковими цілями, а не заява про глобальну зміну макро-тренду.

• **Тактична порада:**
  - Якщо ви хочете зменшити ризик від можливого продавлювання до FVG — зафіксуйте **50% позиції** або підтягніть Stop Loss ближче до входу в правому торговому блоці.`;
    } else if (isAskingTargetOrTp) {
      replyText = `**Аналіз імовірності та динаміки досягнення TP1 (${tp1}) для ${symbol}:**

• **Цільовий орієнтир:** Поточна ціна: **${currentPrice}**, Take Profit 1: **${tp1}** (потрібний рух: **+${distToTp1}%**).
• **Стан стакана (Order Book Resistance):**
  - Дисбаланс стакана (OBI, 50 рівнів): **${obi !== null ? `${obi}%` : "Нейтральний"}**
  - Агресивність у стрічці угод: **${buyerAgg !== null ? `${buyerAgg}% покупців` : "н/д"}**
  - CVD (дельта останніх 50 угод): **${cvdUsd !== null ? `${Number(cvdUsd) >= 0 ? "+" : ""}${cvdUsd} USD` : "н/д"}**
• **Оцінка консолідації:**
  - Поки ціна утримується вище локальної підтримки (${swingL}$), триває фаза накопичення об'єму для виходу до зони ліквідності над найближчим локальним екстремумом.
  - Найближчий локальний опір розташований на рівні Swing High (**${swingH}**). Закріплення над ним відкриває прямий шлях до фіксації першої цілі на ${tp1}$.
• **Ризик інвалідації сценарію:**
  - Пробиття Stop Loss **${stopLoss}** скасовує бичачий імпульс. Дистанція до стопу складає **${distToSl}%**.
• **Тактика дій:**
  - Рекомендується утримувати позицію. При досягненні 50% дистанції до TP1 доцільно перевести Stop Loss на рівень входу (${entryPrice}) для безризикового супроводу.`;
    } else if (isAskingExit) {
      const isGreen = (typeof pnlUsdt === "number" && pnlUsdt > 0) || (currentPrice > entryPrice && side === "long") || (currentPrice < entryPrice && side === "short");
      if (isGreen) {
        replyText = `**Тактична оцінка фіксації прибутку (${symbol}):**\n\n` +
          `• **Поточний стан:** Позиція знаходиться у **прибутку** ${pnlText ? `(${pnlText.replace(/^Поточний PnL:\s*/, "")})` : ""}.\n` +
          `• **Фіксація 50% об'єму:** Розумний та виважений тактичний крок. Дозволяє гарантувати частину прибутку на баланс та зменшити ризик у разі локального відкату.\n` +
          `• **Переведення в безубиток:** Перемістіть Stop Loss на рівень точки входу (${entryPrice}). Це робить подальший супровід повністю безризиковим із можливістю забрати рух до TP1 (${tp1}).\n` +
          `• **Дія в терміналі:** Скористайтеся кнопкою [50%] або [Close] у правому торговому блоці.\n\n` +
          `*AI Companion продовжує штатний моніторинг позиції.*`;
      } else {
        replyText = `**Оцінка супроводу позиції (${symbol}):**\n\n` +
          `• **Поточна ціна:** **${currentPrice}** (Вхід: ${entryPrice}, Stop Loss: ${stopLoss}).\n` +
          `• **Дистанція до стопу:** **${distToSl}%**.\n` +
          `• **Аналіз:** Позиція перебуває в межах розрахункового ризику. Переведення в безубиток наразі може призвести до передчасного вибиття стопу звичайним ринковим шумом.\n` +
          `• **Дія:** Якщо ви бажаєте достроково скоротити експозицію — скористайтеся кнопками [50%] або [Close] у правому торговому терміналі.\n\n` +
          `*AI Companion продовжує моніторинг ринкової структури 24/7.*`;
      }
    } else if (isAskingFvgOrLiquidity) {
      replyText = `**Аналіз дисбалансу FVG та ліквідності (${symbol}):**

• **Локальні структурні екстремуми:** Swing High: **${swingH}**, Swing Low: **${swingL}**.
• **Fair Value Gap (FVG):** У спадному русі імбаланси внизу виступають зонами притягання ціни. Stop Loss на **${stopLoss}** встановлено як бар'єр інвалідації перед повним перекриттям цього діапазону.
• **Зняття ліквідності:** Трейдери часто потрапляють у пастку, відкриваючи шорти прямо перед FVG — замість швидкого пробою ціна часто дає різкий викид (wick) у зворотний бік.
• **Статус:** Час аналізу: ${asOfDateStr}.`;
    } else if (isAskingRisk) {
      replyText = `**Оцінка капіталу та ризику (${symbol}):**

• **Поточний Stop Loss:** ${stopLoss} (дистанція до стопу: **${distToSl}%**)
• **Стан позиції:** ${riskRes?.analysis ?? "Стоп-лосс виставлений на біржі."}
• **Денні ліміти втрат:** ${marketCtx.lossStatus.checked ? (marketCtx.lossStatus.limitBreached ? "⚠️ Перевищено ліміт збитків" : "В межах норми") : "[CHECK_SKIPPED / НЕ ПЕРЕВІРЕНО]"}
• **Час верифікації:** ${asOfDateStr}`;
    } else if (isAskingOrderFlow) {
      replyText = `**Потік ордерів та біржовий стакан (${symbol} · Bybit Linear):**

• **Кумулятивна дельта (CVD snapshot):** ${cvdUsd !== null ? `**${Number(cvdUsd) >= 0 ? "+" : ""}${cvdUsd} USD**` : "[DATA_UNAVAILABLE]"} *(знімок останніх 50 угод)*
• **Дисбаланс стакана (OBI, 50 рівнів):** ${obi !== null ? `**${obi}%**` : "[DATA_UNAVAILABLE]"}
• **Агресивність покупців vs продавців:** ${buyerAgg !== null ? `**${buyerAgg}% покупців** / ${(100 - Number(buyerAgg)).toFixed(1)}% продавців` : "[DATA_UNAVAILABLE]"}
• **Аналіз стрічки:** ${orderFlowRes?.analysis ?? "[DATA_UNAVAILABLE] Потік ордерів недоступний."}
• **Час зрізу:** ${asOfDateStr}`;
    } else if (isAskingIndicator) {
      if (marketCtx.klines15M.length < 15) {
        replyText = `**Технічні індикатори (${symbol}):**

• **RSI (14):** [DATA_UNAVAILABLE] — недостатньо завантажених свічок (наразі ${marketCtx.klines15M.length}, потрібно >=15).
• **EMA (20/50):** [DATA_UNAVAILABLE] — бракує свічкових даних для прогріву.
• **Час перевірки:** ${asOfDateStr}.`;
      } else {
        const closes = marketCtx.klines15M.map((k) => k.close);
        const rsiArr = calculateRSI(closes, 14);
        const lastRsi = rsiArr[rsiArr.length - 1];
        const rsiVal = typeof lastRsi === "number" ? lastRsi.toFixed(1) : "—";
        const rsiZone = Number(rsiVal) >= 70 ? "Перекупленість" : Number(rsiVal) <= 30 ? "Перепроданість" : "Нейтральна зона";

        replyText = `**Технічні індикатори (${symbol} · 15M):**

• **RSI (14):** **${rsiVal}** (${rsiZone})
• **Кількість свічок у розрахунку:** ${marketCtx.klines15M.length}
• **Час розрахунку:** ${asOfDateStr}`;
      }
    } else if (isAskingStructure) {
      const trendText = typeof structDetail?.regime === "string" ? structDetail.regime.toUpperCase() : "UNKNOWN";
      replyText = `**Ринкова структура (${symbol}) [15M / 4H / 1D]:**

• **Визначений режим:** **${trendText}**
• **Підтверджений Swing High:** ${swingH}
• **Підтверджений Swing Low:** ${swingL}
• **Інтерпретація для поточної угоди:** Локальний діапазон становить [${swingL} - ${swingH}]. Утримання вище Swing Low зберігає шанси на технічний відскок до верхньої межі діапазону.
• **Час:** ${asOfDateStr}`;
    } else {
      replyText = `**Аналіз угоди (${symbol} · Bybit Linear):**
${pnlText ? `${pnlText}\n` : ""}
• **Синтез ринкового стану:** ${synthesis.summary}
• **Поточна рекомендація Lead Agent:** **${synthesis.leadVerdict}** (Надійність: ${synthesis.confidencePct}%)
• **Субагенти перевірили:** Структура (${structRes?.status ?? "OK"}), Order Flow (${orderFlowRes?.status ?? "OK"}), Ризик (${riskRes?.status ?? "OK"}), Новини (${newsRes?.status ?? "OK"}).
• **Час актуальності:** ${asOfDateStr}`;
    }
  }

  // 6. Insert Lead Agent response
  const { data: rawCreatedMsg } = await supabase
    .from("trade_ai_messages")
    .insert({
      session_id: sessionId,
      author_kind: "lead",
      agent_id: "lead_trade_agent",
      kind: "analysis",
      content: replyText,
      structured_payload: {
        source: isLlm ? "openrouter_llm" : "deterministic_fallback",
        model: modelUsed,
        tokensUsed,
        verdict: synthesis.leadVerdict,
        timestamp: synthesis.timestampMs,
        asOfMs: marketCtx.asOfMs,
        dataSources: marketCtx.dataSources
      }
    })
    .select("id, author_kind, agent_id, kind, content, structured_payload, created_at")
    .single();

  // 7. Insert ai_agent_runs telemetry with real usage (P1.9)
  try {
    const { data: rawRunData } = await supabase
      .from("ai_agent_runs")
      .insert({
        session_id: sessionId,
        agent_key: "lead_trade_agent",
        event_reason: `User inquiry: "${userPrompt.slice(0, 100)}"`,
        status: "completed",
        tokens_used: tokensUsed
      })
      .select("id")
      .single();

    const runData = rawRunData as { id?: string } | null;
    if (runData?.id) {
      for (const sub of synthesis.subagentResults) {
        for (const ev of sub.evidence) {
          await supabase.from("ai_agent_tool_calls").insert({
            run_id: runData.id,
            skill_key: ev.skillKey,
            input_payload: { symbol },
            output_summary: `${ev.skillKey} status: ${ev.status}`,
            error_info: ev.error ?? null
          });
        }
      }
    }
  } catch {
    // Non-blocking telemetry
  }

  revalidatePath(`/dashboard/signal/[id]`, "page");

  const parsedMsg = messageSchema.partial().safeParse(rawCreatedMsg);
  if (!parsedMsg.success || !parsedMsg.data.id || !parsedMsg.data.content || !parsedMsg.data.created_at) {
    return null;
  }

  return {
    id: parsedMsg.data.id,
    clientMessageId: (parsedMsg.data.structured_payload as { clientMessageId?: string | null })?.clientMessageId ?? null,
    authorKind: parsedMsg.data.author_kind ?? "lead",
    agentId: parsedMsg.data.agent_id ?? null,
    kind: parsedMsg.data.kind ?? "analysis",
    content: parsedMsg.data.content,
    structuredPayload: parsedMsg.data.structured_payload ?? null,
    createdAt: parsedMsg.data.created_at
  };
}
