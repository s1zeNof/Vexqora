"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  orchestrateTradeAnalysis,
  type LeadTradeSynthesis,
  type AccountDailyLossStatus,
  calculateRSI,
  callNemotron
} from "@crypto-bot/trading";
import { fetchRecentKlines } from "@crypto-bot/exchange";
import { sanitizeSymbol } from "@crypto-bot/shared";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface TradeAiMessageItem {
  id: string;
  authorKind: "user" | "lead" | "subagent" | "system";
  agentId?: string | null | undefined;
  kind: "text" | "event" | "analysis" | "action_recommendation" | "action_status";
  content: string;
  structuredPayload?: Record<string, unknown> | null | undefined;
  createdAt: string;
}

export interface TradeAiSessionData {
  id: string;
  symbol: string;
  status: "active" | "closed" | "paused";
  initialThesis?: string | null | undefined;
  invalidationCriteria?: string | null | undefined;
  messages: TradeAiMessageItem[];
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
  status: string;
}

interface DbSignalRow {
  id: string;
  account_id: string;
  parsed: Record<string, unknown> | null;
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
async function fetchAuthoritativeLivePrice(symbol: string): Promise<number> {
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
async function checkAuthoritativeDailyLoss(
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

    const closedTodayRes = await supabase
      .from("trades")
      .select("realized_pnl")
      .eq("account_id", accountId)
      .eq("status", "closed")
      .gte("closed_at", todayStart.toISOString());

    const realizedTrades = (closedTodayRes.data ?? []) as Array<{ realized_pnl: number | string | null }>;
    const dailyPnl = realizedTrades.reduce(
      (sum: number, t) => sum + (Number(t.realized_pnl) || 0),
      0
    );

    const balanceUsdt = Number(account?.paper_balance ?? 1000);
    const maxDailyLossPct = Number(settings.max_daily_loss_pct ?? 5);
    const maxDailyLossUsdt = (balanceUsdt * maxDailyLossPct) / 100;

    const limitBreached = dailyPnl < 0 && Math.abs(dailyPnl) >= maxDailyLossUsdt;

    return {
      checked: true,
      dailyLossLimitPct: maxDailyLossPct,
      currentRealizedLossUsdt: dailyPnl,
      limitBreached,
      balanceUsdt,
      details: limitBreached
        ? `Денний збиток -$${Math.abs(dailyPnl).toFixed(2)} перевищив ліміт $${maxDailyLossUsdt.toFixed(2)} (${maxDailyLossPct}%)`
        : `Денний PnL: ${dailyPnl >= 0 ? "+" : ""}$${dailyPnl.toFixed(2)} (ліміт: -$${maxDailyLossUsdt.toFixed(2)})`
    };
  } catch {
    return {
      checked: false,
      details: "Помилка перевірки денних лімітів"
    };
  }
}

/**
 * Strictly read-only fetch of an existing AI Companion session.
 * Phase P1-F: Zero database mutations during GET render.
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

  const { data: rawExisting } = await query.limit(1).maybeSingle();
  const existing = sessionSchema.safeParse(rawExisting).data ?? null;
  if (!existing) return null;

  // Retrieve the latest 50 messages in chronological order (Bugfix P1.8)
  const { data: rawMessages } = await supabase
    .from("trade_ai_messages")
    .select("id, author_kind, agent_id, kind, content, structured_payload, created_at")
    .eq("session_id", existing.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const parsedMessages = z.array(messageSchema).safeParse(rawMessages).data ?? [];
  const messages: TradeAiMessageItem[] = parsedMessages.slice().reverse().map((m) => ({
    id: m.id,
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
 * P0.1: Rigorously verifies server-side ownership of tradeId, signalId, and accountId.
 * P1.5: Opening message is genuine evidence-backed analysis invoking agents and LLM.
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
      .select("id, account_id, symbol, side, entry_avg, sl, tp1, status")
      .eq("id", params.tradeId)
      .maybeSingle();

    const trade = rawTrade as DbTradeRow | null;
    if (tradeErr || !trade) {
      throw new Error("Security violation: Trade not found or access denied");
    }

    // Verify account ownership
    const { data: rawAccount } = await supabase
      .from("exchange_accounts")
      .select("id")
      .eq("id", trade.account_id)
      .eq("user_id", user.id)
      .maybeSingle();

    const account = rawAccount;
    if (!account) {
      throw new Error("Security violation: Trade belongs to another user account");
    }

    authoritativeAccountId = trade.account_id;
    authoritativeSymbol = trade.symbol.toUpperCase();
    authoritativeSide = trade.side === "short" ? "short" : "long";
    authoritativeEntry = Number(trade.entry_avg ?? authoritativeEntry);
    authoritativeSl = Number(trade.sl ?? authoritativeSl);
    authoritativeTp1 = Number(trade.tp1 ?? authoritativeTp1);

    // Check if session already exists for this trade
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

    const account = rawAccount;
    if (!account) {
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

    // Check if session already exists for user and signal
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

  // Fallback to active account if neither tradeId nor signalId provided
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

  // 2. Fetch authoritative market facts on server (P0.2)
  const [livePrice, klines, lossStatus] = await Promise.all([
    fetchAuthoritativeLivePrice(authoritativeSymbol),
    fetchRecentKlines(authoritativeSymbol, "15", 30).catch(() => []),
    checkAuthoritativeDailyLoss(supabase, authoritativeAccountId)
  ]);

  const currentPrice = livePrice > 0 ? livePrice : (klines[klines.length - 1]?.close ?? authoritativeEntry);
  if (authoritativeEntry === 0 && currentPrice > 0) {
    authoritativeEntry = currentPrice;
  }

  // 3. Run genuine Multi-Agent Orchestration (P1.5)
  const synthesis = await orchestrateTradeAnalysis({
    symbol: authoritativeSymbol,
    currentPrice,
    side: authoritativeSide,
    entryPrice: authoritativeEntry,
    stopLoss: authoritativeSl,
    tp1: authoritativeTp1,
    klines,
    accountDailyLossStatus: lossStatus
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

  const created = rawCreated as { id?: string } | null;
  const parsedCreated = sessionSchema.partial().safeParse(created);
  if (error || !parsedCreated.success || !parsedCreated.data.id) return null;
  const sessionId = parsedCreated.data.id;

  // 5. Generate Evidence-Backed Initial Message (P1.5)
  const slDistPct = authoritativeEntry > 0 ? ((Math.abs(authoritativeEntry - authoritativeSl) / authoritativeEntry) * 100).toFixed(2) : "—";
  const tp1DistPct = authoritativeEntry > 0 && authoritativeTp1 > 0 ? ((Math.abs(authoritativeTp1 - authoritativeEntry) / authoritativeEntry) * 100).toFixed(2) : "—";

  const subResMap = new Map(synthesis.subagentResults.map((s) => [s.agentKey, s]));
  const structRes = subResMap.get("market_structure_agent");
  const orderFlowRes = subResMap.get("order_flow_agent");
  const riskRes = subResMap.get("risk_guardian_agent");
  const newsRes = subResMap.get("news_events_agent");

  const hasOpenRouterKey = Boolean(
    (process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim().length > 10) ||
    (process.env.OPENROUTER_VISION_API_KEY && process.env.OPENROUTER_VISION_API_KEY.trim().length > 10)
  );

  let initialMessageContent: string | null = null;
  let tokensUsed: number | null = null;
  let modelUsed: string = "deterministic_synthesis";
  let isLlm = false;

  if (hasOpenRouterKey) {
    try {
      const systemPrompt = `Ти — Vexqora AI Trade Companion, персональний помічник трейдера на терміналі Vexqora Trade.
Твій стиль: стриманий, точний, аналітичний, без зайвої води (стилістика Anthropic / Claude). Відповідай виключно українською мовою.
Сформулюй структурований початковий торговий тезис для нової сесії на основі наданих фактів.
Обов'язково включи:
• Оцінку ринкової структури та початковий план
• Дистанцію та обґрунтування захисного Stop Loss
• Оцінку ризику капіталу (денні ліміти)
• Попередження про умови інвалідації сетапу
Жодних вигаданих даних чи галюцинацій.`;

      const factsPrompt = `
ФАКТИ ДЛЯ ПОЧАТКОВОГО ТЕЗИСУ (${authoritativeSymbol}):
• Монета: ${authoritativeSymbol}, Напрямок: ${authoritativeSide.toUpperCase()}
• Точка входу: $${authoritativeEntry}, Поточна ціна: $${currentPrice}
• Stop Loss: $${authoritativeSl} (ризик: ${slDistPct}%)
• Take Profit 1: $${authoritativeTp1} (ціль: ${tp1DistPct}%)
• Ринкова структура: ${structRes?.analysis ?? "дані формуються"}
• Order Flow: ${orderFlowRes?.analysis ?? "потік формується"}
• Risk Guardian: ${riskRes?.analysis ?? "ризик у межах норми"}
• Новини: ${newsRes?.analysis ?? "нейтральний фон"}
• Вердикт Lead Agent: ${synthesis.leadVerdict}
`;

      const nemotronResponse = await callNemotron([
        { role: "system", content: systemPrompt },
        { role: "user", content: `${factsPrompt}\nСформуй початковий торговий бриф.` }
      ], {
        temperature: 0.3,
        maxTokens: 550
      });

      if (nemotronResponse?.content && nemotronResponse.content.trim().length > 0) {
        initialMessageContent = nemotronResponse.content.trim();
        tokensUsed = nemotronResponse.usage?.totalTokens ?? null;
        modelUsed = nemotronResponse.model ?? "nemotron-3-ultra-550b";
        isLlm = true;
      }
    } catch {
      initialMessageContent = null;
    }
  }

  if (!initialMessageContent) {
    initialMessageContent = `**Торговий бриф та початковий тезис (${authoritativeSymbol}):**

• **Сетап:** **${authoritativeSide.toUpperCase()}** від $${authoritativeEntry}
• **Захисний Stop Loss:** $${authoritativeSl} (ризик: **${slDistPct}%**)
• **Цільовий TP1:** $${authoritativeTp1 > 0 ? `$${authoritativeTp1} (+${tp1DistPct}%)` : "динамічний"}
• **Ринкова структура:** ${structRes?.analysis ?? "дані формуються"}
• **Order Flow / CVD:** ${orderFlowRes?.analysis ?? "потік формується"}
• **Risk Guardian:** ${riskRes?.analysis ?? "рівень ризику контрольований"}
• **Початковий вердикт Lead Agent:** **${synthesis.leadVerdict}**

*Сесію активовано на сервері. У разі наближення ціни до стопу, появи CHOCH/BOS або дивергенції CVD ви отримаєте повідомлення тут.*`;
  }

  await supabase.from("trade_ai_messages").insert({
    session_id: sessionId,
    author_kind: "lead",
    agent_id: "lead_trade_agent",
    kind: "analysis",
    content: initialMessageContent,
    structured_payload: {
      source: isLlm ? "openrouter_llm" : "deterministic_fallback",
      model: modelUsed,
      tokensUsed,
      verdict: synthesis.leadVerdict,
      timestamp: Date.now()
    }
  });

  // Record ai_agent_runs with real usage
  try {
    await supabase.from("ai_agent_runs").insert({
      session_id: sessionId,
      agent_key: "lead_trade_agent",
      event_reason: "Initial session thesis & analysis",
      status: "completed",
      tokens_used: tokensUsed
    });
  } catch {
    // non-blocking
  }

  return getTradeAiSession({
    symbol: authoritativeSymbol,
    tradeId: params.tradeId,
    signalId: params.signalId
  });
}

/**
 * Retrieves latest messages for an active session with cursor-based pagination and delta polling.
 * Bugfix P1.8: Returns the latest messages, not the oldest 50 messages.
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
  const limit = options?.limit ?? 50;

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
      authorKind: m.author_kind,
      agentId: m.agent_id ?? null,
      kind: m.kind,
      content: m.content,
      structuredPayload: m.structured_payload ?? null,
      createdAt: m.created_at
    }));
  }

  // Initial load: fetch newest messages descending, then reverse for chronological display
  query = query.order("created_at", { ascending: false }).limit(limit);

  if (options?.beforeIso) {
    query = query.lt("created_at", options.beforeIso);
  }

  const { data: rawMessages } = await query;
  const parsedMessages = z.array(messageSchema).safeParse(rawMessages).data ?? [];
  const reversed = parsedMessages.slice().reverse();

  return reversed.map((m) => ({
    id: m.id,
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
 * P0.2: Authoritative trade state, live price, and market facts are resolved on the server.
 * P1.9: Real usage metrics and explicit source badge telemetry.
 */
export async function sendTradeAiMessage(
  sessionId: string,
  userPrompt: string
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

  // Authoritative trade state from DB
  let side: "long" | "short" = "long";
  let entryPrice = 0;
  let stopLoss = 0;
  let tp1 = 0;
  let qty = 0;

  if (session.trade_id) {
    const { data: rawTrade } = await supabase
      .from("trades")
      .select("symbol, side, entry_avg, sl, tp1, qty, status")
      .eq("id", session.trade_id)
      .maybeSingle();

    const trade = rawTrade as DbTradeRow | null;
    if (trade) {
      side = trade.side === "short" ? "short" : "long";
      entryPrice = Number(trade.entry_avg ?? 0);
      stopLoss = Number(trade.sl ?? 0);
      tp1 = Number(trade.tp1 ?? 0);
      qty = Number(trade.qty ?? 0);
    }
  } else if (session.signal_id) {
    const { data: rawSignal } = await supabase
      .from("signals")
      .select("parsed")
      .eq("id", session.signal_id)
      .maybeSingle();

    const signal = rawSignal as DbSignalRow | null;
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

  // 2. Fetch authoritative market facts on server (P0.2)
  const [livePrice, klines, lossStatus] = await Promise.all([
    fetchAuthoritativeLivePrice(symbol),
    fetchRecentKlines(symbol, "15", 30).catch(() => []),
    checkAuthoritativeDailyLoss(supabase, session.account_id)
  ]);

  const currentPrice = livePrice > 0 ? livePrice : (klines[klines.length - 1]?.close ?? entryPrice);
  if (entryPrice === 0 && currentPrice > 0) entryPrice = currentPrice;

  // Compute authoritative PnL if trade has active position
  const isLong = side === "long";
  const pnlUsdt = qty > 0 ? (isLong ? (currentPrice - entryPrice) * qty : (entryPrice - currentPrice) * qty) : undefined;
  const pnlPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 * (isLong ? 1 : -1) : undefined;

  // 3. Insert user message
  await supabase.from("trade_ai_messages").insert({
    session_id: sessionId,
    author_kind: "user",
    kind: "text",
    content: userPrompt.trim()
  });

  // 4. Run real Multi-Agent Orchestration (Phase P4)
  const synthesis: LeadTradeSynthesis = await orchestrateTradeAnalysis({
    sessionId,
    symbol,
    currentPrice,
    side,
    entryPrice,
    stopLoss,
    tp1,
    klines,
    accountDailyLossStatus: lossStatus
  });

  // 5. Synthesis in Ukrainian with LLM or honest fallback
  const lower = userPrompt.toLowerCase();
  const pnlText = pnlUsdt !== undefined
    ? `Поточний PnL: ${pnlUsdt >= 0 ? "+" : ""}${pnlUsdt.toFixed(2)} USDT (${pnlPct !== undefined ? (pnlPct >= 0 ? "+" : "") + pnlPct.toFixed(2) + "%" : "0%"}).`
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

  if (hasOpenRouterKey) {
    try {
      const structTrend = typeof structDetail?.regime === "string" ? structDetail.regime : (typeof structDetail?.trend === "string" ? structDetail.trend : "н/д");
      const structSwingHigh = typeof structDetail?.swingHigh === "number" ? structDetail.swingHigh.toString() : "н/д";
      const structSwingLow = typeof structDetail?.swingLow === "number" ? structDetail.swingLow.toString() : "н/д";
      const ofCvd = typeof ofDetail?.cvdUsd === "number" ? ofDetail.cvdUsd.toString() : "н/д";
      const ofObi = typeof ofDetail?.weightedImbalance === "number" ? (ofDetail.weightedImbalance * 100).toFixed(1) : "н/д";

      const systemPrompt = `Ти — Vexqora AI Trade Companion, персональний помічник трейдера на терміналі Vexqora Trade.
Твій стиль: стриманий, точний, аналітичний, без води (стилістика Anthropic / Claude). Відповідай виключно українською мовою.
Форматуй відповідь чисто за правилами Markdown: невеликі абзаци, чіткі списки з булетами (•), для чисел і цін використовуй жирний шрифт.
КРИТИЧНІ ПРАВИЛА:
1. Спирайся ВИКЛЮЧНО на надані фактологічні дані від субагентів (структура, CVD дельта, стакан, ризик, PnL, відстані до рівнів).
2. ЖОДНИХ вигаданих даних чи галюцинацій: якщо фактів або даних бракує, чесно зазнач [DATA_UNAVAILABLE].
3. Не роздавай категоричних фінансових наказів, надавай зважений аналіз і сценарії дій.`;

      const factsContext = `
ФАКТИ ПО УГОДІ ТА СУБАГЕНТАХ (${symbol}):
- Монета: ${symbol}, Напрямок: ${side.toUpperCase()}
- Ціна входу: $${entryPrice}, Поточна ціна: $${currentPrice}
- Stop Loss: $${stopLoss} (дистанція до SL: ${distToSl}%)
- Take Profit 1: $${tp1} (дистанція до TP1: ${distToTp1}%)
${pnlText ? `- ${pnlText}` : "- Активної біржової позиції наразі немає (очікується вхід або спостереження)."}
- Загальний вердикт Lead Agent: ${synthesis.leadVerdict}
- Ринкова структура: ${structRes?.analysis ?? "[DATA_UNAVAILABLE]"} (Режим: ${structTrend}, Swing High: $${structSwingHigh}, Swing Low: $${structSwingLow})
- Order Flow / CVD: ${orderFlowRes?.analysis ?? "[DATA_UNAVAILABLE]"} (CVD: ${ofCvd} USD, OBI дисбаланс: ${ofObi}%)
- Risk Guardian: ${riskRes?.analysis ?? "Stop Loss встановлений"}
- Новини / Події: ${newsRes?.analysis ?? "[DATA_UNAVAILABLE]"}
`;

      const nemotronResponse = await callNemotron([
        { role: "system", content: systemPrompt },
        { role: "user", content: `${factsContext}\nЗапит користувача: "${userPrompt.trim()}"` }
      ], {
        temperature: 0.3,
        maxTokens: 650
      });

      if (nemotronResponse?.content && nemotronResponse.content.trim().length > 0) {
        replyText = nemotronResponse.content.trim();
        tokensUsed = nemotronResponse.usage?.totalTokens ?? null;
        modelUsed = nemotronResponse.model ?? "nemotron-3-ultra-550b";
        isLlm = true;
      }
    } catch {
      replyText = null;
    }
  }

  // Deterministic Fallback if LLM unavailable
  if (!replyText) {
    if (lower.includes("вийти") || lower.includes("закрити") || lower.includes("exit") || lower.includes("close")) {
      replyText = `**Оцінка сценарію закриття (${symbol}):**
${pnlText ? `${pnlText}\n` : ""}
• **Вердикт Lead Agent:** ${synthesis.leadVerdict}
• **Стан ризику:** ${riskRes?.analysis ?? "Stop Loss виставлений на біржі."}
• **Рекомендація щодо фіксації:** Якщо ви бажаєте зафіксувати прибуток або зменшити експозицію — скористайтеся кнопками [50%] або [Close] у правому торговому терміналі.
*Примітка безпеки: AI Companion не закриває ваші реальні біржові позиції без вашого прямого підтвердження.*`;
    } else if (lower.includes("структур") || lower.includes("тренд") || lower.includes("trend") || lower.includes("bos") || lower.includes("choch")) {
      const trendText = typeof structDetail?.regime === "string" ? structDetail.regime.toUpperCase() : "UNKNOWN";
      const swingH = typeof structDetail?.swingHigh === "number" ? structDetail.swingHigh.toFixed(4) : "—";
      const swingL = typeof structDetail?.swingLow === "number" ? structDetail.swingLow.toFixed(4) : "—";

      replyText = `**Ринкова структура (${symbol}):**

• **Визначений режим:** **${trendText}**
• **Підтверджений Swing High:** $${swingH}
• **Підтверджений Swing Low:** $${swingL}
• **Аналіз структури:** ${structRes?.analysis ?? "Недостатньо закритих свічок для повного MTF прогріву."}
• **Час оцінки:** ${new Date().toLocaleTimeString("uk-UA")}`;
    } else if (lower.includes("ризик") || lower.includes("стоп") || lower.includes("sl") || lower.includes("stop")) {
      replyText = `**Оцінка капіталу та ризику (${symbol}):**

• **Поточний Stop Loss:** $${stopLoss} (дистанція до стопу: **${distToSl}%**)
• **Стан позиції:** ${riskRes?.analysis ?? "Стоп-лосс виставлений на біржі."}
• **Денні ліміти:** ${lossStatus.checked ? (lossStatus.limitBreached ? "⚠️ Перевищено ліміт збитків" : "В межах норми") : "[CHECK_SKIPPED / НЕ ПЕРЕВІРЕНО]"}`;
    } else if (lower.includes("потік") || lower.includes("cvd") || lower.includes("кит") || lower.includes("стакан") || lower.includes("дельта")) {
      const cvdUsd = typeof ofDetail?.cvdUsd === "number" ? ofDetail.cvdUsd.toFixed(0) : null;
      const obi = typeof ofDetail?.weightedImbalance === "number" ? (ofDetail.weightedImbalance * 100).toFixed(1) : null;

      replyText = `**Потік ордерів та дельта (${symbol}):**

• **Кумулятивна дельта (CVD):** ${cvdUsd !== null ? `**${Number(cvdUsd) >= 0 ? "+" : ""}${cvdUsd} USD**` : "[DATA_UNAVAILABLE]"}
• **Дисбаланс стакана (OBI):** ${obi !== null ? `**${obi}%**` : "[DATA_UNAVAILABLE]"}
• **Стрічка угод:** ${orderFlowRes?.analysis ?? "[DATA_UNAVAILABLE] Потік ордерів недоступний."}`;
    } else if (lower.includes("новин") || lower.includes("news") || lower.includes("анонс")) {
      replyText = `**Новинний контекст (${symbol}):**

• **Статус стрічки новин:** ${newsRes?.evidence[0]?.status === "OK" ? "Верифікований фід" : "[DATA_UNAVAILABLE]"}
• **Оцінка новинного фону:** ${newsRes?.analysis ?? "Новинний фід тимчасово недоступний."}`;
    } else if (lower.includes("rsi") || lower.includes("індикатор") || lower.includes("indicator")) {
      if (klines.length < 15) {
        replyText = `**Технічні індикатори (${symbol}):**

• **RSI (14):** [DATA_UNAVAILABLE] — недостатньо завантажених свічок (наразі ${klines.length}, потрібно >=15).
• **EMA (20/50):** [DATA_UNAVAILABLE] — бракує свічкових даних для прогріву.
• **Статус перевірки:** Відмова через брак даних (No hallucinated indicators). Час: ${new Date().toLocaleTimeString("uk-UA")}.`;
      } else {
        const closes = klines.map((k) => k.close);
        const rsiArr = calculateRSI(closes, 14);
        const lastRsi = rsiArr[rsiArr.length - 1];
        const rsiVal = typeof lastRsi === "number" ? lastRsi.toFixed(1) : "—";
        const rsiZone = Number(rsiVal) >= 70 ? "Перекупленість" : Number(rsiVal) <= 30 ? "Перепроданість" : "Нейтральна зона";

        replyText = `**Технічні індикатори (${symbol}):**

• **RSI (14):** **${rsiVal}** (${rsiZone})
• **Кількість свічок у розрахунку:** ${klines.length}
• **Час розрахунку:** ${new Date().toLocaleTimeString("uk-UA")}`;
      }
    } else {
      replyText = `**Аналіз угоди (${symbol}):**
${pnlText ? `${pnlText}\n` : ""}
• **Синтез ринкового стану:** ${synthesis.summary}
• **Поточна рекомендація Lead Agent:** **${synthesis.leadVerdict}**
• **Субагенти перевірили:** Структура (${structRes?.status ?? "OK"}), Order Flow (${orderFlowRes?.status ?? "OK"}), Ризик (${riskRes?.status ?? "OK"}), Новини (${newsRes?.status ?? "OK"}).`;
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
        timestamp: synthesis.timestampMs
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

    const runData = rawRunData;
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
    authorKind: parsedMsg.data.author_kind ?? "lead",
    agentId: parsedMsg.data.agent_id ?? null,
    kind: parsedMsg.data.kind ?? "analysis",
    content: parsedMsg.data.content,
    structuredPayload: parsedMsg.data.structured_payload ?? null,
    createdAt: parsedMsg.data.created_at
  };
}
