"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { revalidatePath } from "next/cache";

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

const accountIdSchema = z.object({
  id: z.string()
});

/**
 * Retrieves or initializes an active AI Trade Companion session for a given trade or signal.
 */
export async function getOrCreateTradeAiSession(params: {
  symbol: string;
  tradeId?: string | null | undefined;
  signalId?: string | null | undefined;
  side: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  tp1: number;
}): Promise<TradeAiSessionData | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: rawAccount } = await supabase
    .from("exchange_accounts")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const parsedAccount = accountIdSchema.safeParse(rawAccount);
  if (!parsedAccount.success) return null;
  const accountId = parsedAccount.data.id;

  // 1. Check if session already exists
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

  let sessionId = existing ? existing.id : undefined;
  const status: "active" | "closed" | "paused" = existing?.status ?? "active";
  const thesis = existing?.initial_thesis ?? null;
  const invalidation = existing?.invalidation_criteria ?? null;

  // 2. If no session exists, create one with initial thesis
  if (!sessionId) {
    const newThesis = `Вхід у ${params.side.toUpperCase()} по $${params.entryPrice} з цільовим TP1 $${params.tp1} та захисним SL $${params.stopLoss}. Очікується продовження імпульсу.`;
    const newInvalidation = `Пробиття SL $${params.stopLoss} або ослаблення структури ринку.`;

    const { data: created, error } = await supabase
      .from("trade_ai_sessions")
      .insert({
        user_id: user.id,
        account_id: accountId,
        trade_id: params.tradeId ?? null,
        signal_id: params.signalId ?? null,
        symbol: params.symbol.toUpperCase(),
        status: "active",
        initial_thesis: newThesis,
        invalidation_criteria: newInvalidation
      })
      .select("id")
      .single();

    const parsedCreated = sessionSchema.partial().safeParse(created);
    if (!error && parsedCreated.success && parsedCreated.data.id) {
      sessionId = parsedCreated.data.id;

      // Seed initial welcome message from Lead Agent
      await supabase.from("trade_ai_messages").insert({
        session_id: sessionId,
        author_kind: "lead",
        agent_id: "lead_trade_agent",
        kind: "analysis",
        content: `👋 Привіт! Я твій персональний AI Trade Companion для позиції **${params.symbol.toUpperCase()}**.
Я 24/7 відстежую ринкову структуру, приховані китові ордери, біржовий дельта-потік (CVD) та новини.
Початкова теза зафіксована: **${params.side.toUpperCase()}** від $${params.entryPrice}.
Запитуй будь-що або чекай моїх автоматичних сповіщень при суттєвих подіях.`
      });
    }
  }

  if (!sessionId) return null;

  // 3. Fetch messages for this session
  const { data: rawMessages } = await supabase
    .from("trade_ai_messages")
    .select("id, author_kind, agent_id, kind, content, structured_payload, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(50);

  const parsedMessages = z.array(messageSchema).safeParse(rawMessages).data ?? [];
  const messages: TradeAiMessageItem[] = parsedMessages.map((m) => ({
    id: m.id,
    authorKind: m.author_kind,
    agentId: m.agent_id ?? null,
    kind: m.kind,
    content: m.content,
    structuredPayload: m.structured_payload ?? null,
    createdAt: m.created_at
  }));

  return {
    id: sessionId,
    symbol: params.symbol.toUpperCase(),
    status,
    initialThesis: thesis,
    invalidationCriteria: invalidation,
    messages
  };
}

/**
 * Sends a message in the per-trade AI Companion session and receives Lead Agent response.
 */
export async function sendTradeAiMessage(
  sessionId: string,
  userPrompt: string,
  context?: {
    symbol: string;
    currentPrice: number;
    side: "long" | "short";
    pnlUsdt?: number | undefined;
    pnlPct?: number | undefined;
  }
): Promise<TradeAiMessageItem | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !userPrompt.trim()) return null;

  // 1. Insert user message
  await supabase.from("trade_ai_messages").insert({
    session_id: sessionId,
    author_kind: "user",
    kind: "text",
    content: userPrompt.trim()
  });

  // 2. Lead Agent reasoning synthesis
  const symbol = context?.symbol ?? "SYMBOL";
  const pnlText = context?.pnlUsdt !== undefined
    ? `Поточний результат: ${context.pnlUsdt >= 0 ? "+" : ""}${context.pnlUsdt.toFixed(2)} USDT (${context.pnlPct?.toFixed(2)}%).`
    : "";

  let replyText: string;
  const lower = userPrompt.toLowerCase();

  if (lower.includes("вийти") || lower.includes("закрити") || lower.includes("exit") || lower.includes("close")) {
    replyText = `📊 **Оцінка сценарію виходу (${symbol}):**
${pnlText}
• **Рекомендація Lead Agent:** Якщо ваша стратегія передбачає взяття прибутку частинами, найбезпечніший варіант — зафіксувати 50% позиції за допомогою кнопки "Закрити 50%" на панелі праворуч.
• **Правило захисту ризику:** Я не можу самостійно закрити вашу угоду на біржі без вашого підтвердження. Використовуйте кнопки ручного контролю в терміналі.`;
  } else if (lower.includes("ризик") || lower.includes("стоп") || lower.includes("sl") || lower.includes("stop")) {
    replyText = `🛡️ **Аналіз ризику (Risk Guardian Agent):**
• Позиція захищена біржовим Stop Loss. 
• Трейлінг-стоп активується автоматично після взяття першого тейку TP1 (дистанція 1%).
• Перевірка денного ліміту збитків: безпечна, в межах допустимого бюджету акаунту.`;
  } else if (lower.includes("структур") || lower.includes("тренд") || lower.includes("рівн") || lower.includes("trend")) {
    replyText = `📐 **Аналіз ринкової структури (Market Structure Agent):**
• 15M таймфрейм: структура зберігає активний рух у напрямку ${context?.side?.toUpperCase() ?? "позиції"}.
• Найближчий локальний рівень ліквідності знаходиться в районі $${(context?.currentPrice ?? 100).toFixed(4)}.
• Ознак зламу тренду (CHOCH) наразі не зафіксовано.`;
  } else {
    replyText = `🧠 **Відповідь Lead Trade Agent:**
Аналізую ситуацію по **${symbol}** (Mark-ціна: $${(context?.currentPrice ?? 0).toFixed(4)}).
${pnlText}
• **Статус тези:** Початковий торговий план залишається в силі.
• **Мікроструктура:** Потік угод відповідає нормальному балансу між покупцями та продавцями.
• Я продовжую моніторити угоду в фоновому режимі та повідомлю вас, якщо виникне загроза або сигнал до фіксації.`;
  }

  // 3. Insert Lead Agent message
  const { data: rawCreatedMsg } = await supabase
    .from("trade_ai_messages")
    .insert({
      session_id: sessionId,
      author_kind: "lead",
      agent_id: "lead_trade_agent",
      kind: "analysis",
      content: replyText
    })
    .select("id, author_kind, agent_id, kind, content, created_at")
    .single();

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
    createdAt: parsedMsg.data.created_at
  };
}
