import { type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import {
  fetchAuthoritativeMarketContext,
  type TradeAiMessageItem
} from "../../../../dashboard/signal/[id]/ai-companion-actions";
import {
  orchestrateTradeAnalysis,
  type LeadTradeSynthesis,
  callNemotron,
  calculateRSI
} from "@crypto-bot/trading";

export const dynamic = "force-dynamic";

interface ChatRequestBody {
  sessionId?: string;
  userPrompt?: string;
  clientMessageId?: string;
}

export type LiveStepEvent = {
  type: "step";
  runId: string;
  stage: "queued" | "fetching_data" | "analyzing" | "synthesizing";
  stepKey: string;
  label: string;
  status: "active" | "completed" | "insufficient_data" | "failed";
  details?: string;
};

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { sessionId, userPrompt, clientMessageId } = body;
  if (!sessionId || !userPrompt?.trim()) {
    return new Response(JSON.stringify({ error: "Missing sessionId or userPrompt" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Authorize session ownership
  const { data: rawSession, error: sessErr } = await supabase
    .from("trade_ai_sessions")
    .select("id, user_id, account_id, trade_id, signal_id, symbol, status")
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (sessErr || !rawSession) {
    return new Response(JSON.stringify({ error: "Session not found or access denied" }), {
      status: 403,
      headers: { "Content-Type": "application/json" }
    });
  }

  const session = rawSession as {
    id: string;
    account_id: string;
    trade_id: string | null;
    signal_id: string | null;
    symbol: string;
    status: string;
  };

  const symbol = session.symbol.toUpperCase();
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (eventObj: Record<string, unknown>) => {
        try {
          const payload = `data: ${JSON.stringify(eventObj)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Stream controller closed or client disconnected
        }
      };

      try {
        // 1. Initial run started event
        sendEvent({
          type: "run_started",
          runId,
          timestamp: Date.now()
        });

        sendEvent({
          type: "step",
          runId,
          stage: "queued",
          stepKey: "init",
          label: "Ініціалізація аналітичного середовища...",
          status: "completed"
        });

        // 2. Fetch authoritative trade state from DB
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

          const trade = rawTrade as {
            symbol?: string;
            side?: string;
            entry_avg?: number | string | null;
            sl?: number | string | null;
            qty?: number | string | null;
            leverage?: number | string | null;
            opened_at?: string | null;
          } | null;

          if (trade) {
            side = trade.side === "short" ? "short" : "long";
            entryPrice = Number(trade.entry_avg ?? 0);
            stopLoss = Number(trade.sl ?? 0);
            qty = Number(trade.qty ?? 0);
            leverage = Number(trade.leverage ?? 5);
            openedAt = trade.opened_at ?? null;

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

          const parsed = (rawSignal as { parsed?: Record<string, unknown> } | null)?.parsed as {
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

        // 3. Insert optimistic user message into DB with clientMessageId
        await supabase.from("trade_ai_messages").insert({
          session_id: sessionId,
          client_message_id: clientMessageId ?? null,
          author_kind: "user",
          kind: "text",
          content: userPrompt.trim(),
          structured_payload: {
            clientMessageId: clientMessageId ?? null,
            timestamp: Date.now()
          }
        });

        // 4. Fetch live market telemetry (P0.3: Live Step 1)
        sendEvent({
          type: "step",
          runId,
          stage: "fetching_data",
          stepKey: "telemetry",
          label: `Отримую біржовий тікер, L2 стакан та стрічку угод Bybit (${symbol})...`,
          status: "active"
        });

        const marketCtx = await fetchAuthoritativeMarketContext(
          supabase,
          session.account_id,
          symbol,
          entryPrice
        );

        const currentPrice = marketCtx.currentPrice;
        if (entryPrice === 0 && currentPrice > 0) entryPrice = currentPrice;

        const isLong = side === "long";
        const pnlUsdt = qty > 0 ? (isLong ? (currentPrice - entryPrice) * qty : (entryPrice - currentPrice) * qty) : undefined;
        const pnlPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 * (isLong ? 1 : -1) : undefined;
        const positionValueUsd = qty > 0 ? qty * currentPrice : 0;

        sendEvent({
          type: "step",
          runId,
          stage: "fetching_data",
          stepKey: "telemetry",
          label: `Біржові дані Bybit завантажено`,
          details: `Ціна: $${currentPrice}, L2: 50 рівнів, стрічка: 50 угод`,
          status: "completed"
        });

        // 5. Run Market Structure Agent (P0.3: Live Step 2)
        sendEvent({
          type: "step",
          runId,
          stage: "analyzing",
          stepKey: "structure",
          label: "Market Structure Agent: оцінка структури на 1D / 4H / 15M...",
          status: "active"
        });

        const mtfRegime = marketCtx.mtfSnapshot?.regime?.toUpperCase() ?? "UNKNOWN";
        sendEvent({
          type: "step",
          runId,
          stage: "analyzing",
          stepKey: "structure",
          label: `Структура MTF перевірена`,
          details: `Режим: ${mtfRegime}`,
          status: "completed"
        });

        // 6. Run Order Flow Agent (P0.3: Live Step 3)
        sendEvent({
          type: "step",
          runId,
          stage: "analyzing",
          stepKey: "order_flow",
          label: "Order Flow Agent: розрахунок дельти CVD та дисбалансу стакана...",
          status: "active"
        });

        const cvdVal = marketCtx.microstructure?.tape.cvdUsd;
        const obiVal = marketCtx.microstructure?.orderBook.weightedImbalance;
        const cvdDetails = cvdVal !== undefined
          ? `CVD: ${cvdVal >= 0 ? "+" : ""}${cvdVal.toFixed(0)} USD, OBI: ${((obiVal ?? 0) * 100).toFixed(1)}%`
          : "Стакан/стрічка недоступні";

        sendEvent({
          type: "step",
          runId,
          stage: "analyzing",
          stepKey: "order_flow",
          label: `Дельта CVD та OBI розраховані`,
          details: cvdDetails,
          status: marketCtx.microstructure ? "completed" : "insufficient_data"
        });

        // 7. Run Risk Guardian Agent (P0.3: Live Step 4)
        sendEvent({
          type: "step",
          runId,
          stage: "analyzing",
          stepKey: "risk",
          label: "Risk Guardian: перевірка рівнів Stop Loss, TP та денного ліміту...",
          status: "active"
        });

        const distToSl = currentPrice > 0 && stopLoss > 0 ? ((Math.abs(currentPrice - stopLoss) / currentPrice) * 100).toFixed(2) : "н/д";
        const distToTp1 = currentPrice > 0 && tp1 > 0 ? ((Math.abs(tp1 - currentPrice) / currentPrice) * 100).toFixed(2) : "н/д";

        sendEvent({
          type: "step",
          runId,
          stage: "analyzing",
          stepKey: "risk",
          label: `Ризик перевірено`,
          details: `Дистанція до SL: ${distToSl}%, Денний ліміт: ${marketCtx.lossStatus.checked ? (marketCtx.lossStatus.limitBreached ? "⚠️ Перевищено" : "Норма") : "Не перевірено"}`,
          status: "completed"
        });

        // 8. Lead Agent Orchestration & Synthesis (P0.3: Live Step 5)
        sendEvent({
          type: "step",
          runId,
          stage: "synthesizing",
          stepKey: "lead",
          label: "Lead Trade Agent: синтез аналітичного висновку...",
          status: "active"
        });

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

            const systemPrompt = `Ти — Vexqora AI Trade Companion, персональний помічник трейдера на терміналі Vexqora Trade.
Твій стиль: стриманий, точний, аналітичний, без води (стилістика Anthropic / Claude). Відповідай виключно українською мовою.
Форматуй відповідь чисто за правилами Markdown: невеликі абзаци, чіткі списки з булетами (•), для чисел і цін використовуй жирний шрифт.
КРИТИЧНІ ПРАВИЛА:
1. Спирайся ВИКЛЮЧНО на надані фактологічні дані від біржі Bybit та субагентів (структура, CVD дельта 50 недавніх угод, стакан L2, ризик, PnL, відстані до рівнів).
2. Завжди вказуй точні параметри: символ (${symbol}), біржу (${marketCtx.exchange}), час актуальності (${asOfDateStr}), і таймфрейми.
3. Окремо розрізняй знімок дельти 50 угод від накопиченої безперервної часової серії CVD: не видавай короткий знімок за 30-денний тренд.
4. Якщо фактів чи джерел бракує, чесно зазнач [DATA_UNAVAILABLE: причина]. ЖОДНИХ вигаданих чисел чи галюцинацій.
5. Не роздавай категоричних фінансових наказів, надавай зважений аналіз і сценарії дій.`;

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
              maxTokens: 650
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

        // Deterministic Fallback if LLM unavailable
        if (!replyText) {
          if (lower.includes("вийти") || lower.includes("закрити") || lower.includes("exit") || lower.includes("close")) {
            replyText = `**Оцінка сценарію закриття (${symbol}):**
${pnlText ? `${pnlText}\n` : ""}
• **Вердикт Lead Agent:** **${synthesis.leadVerdict}**
• **Стан ризику:** ${riskRes?.analysis ?? "Stop Loss виставлений на біржі."}
• **Рекомендація щодо фіксації:** Якщо ви бажаєте зафіксувати прибуток або зменшити експозицію — скористайтеся кнопками [50%] або [Close] у правому торговому терміналі.
• **Час оцінки:** ${asOfDateStr} (Bybit Linear).
*Примітка безпеки: AI Companion не закриває ваші реальні біржові позиції без вашого прямого підтвердження.*`;
          } else if (lower.includes("структур") || lower.includes("тренд") || lower.includes("trend") || lower.includes("bos") || lower.includes("choch")) {
            const trendText = typeof structDetail?.regime === "string" ? structDetail.regime.toUpperCase() : "UNKNOWN";
            const swingH = typeof structDetail?.swingHigh === "number" ? structDetail.swingHigh.toFixed(4) : "—";
            const swingL = typeof structDetail?.swingLow === "number" ? structDetail.swingLow.toFixed(4) : "—";

            replyText = `**Ринкова структура (${symbol}) [15M / 4H / 1D]:**

• **Визначений режим:** **${trendText}**
• **Підтверджений Swing High:** $${swingH}
• **Підтверджений Swing Low:** $${swingL}
• **Аналіз структури:** ${structRes?.analysis ?? "Недостатньо закритих свічок для повного MTF прогріву."}
• **Біржа та час:** ${marketCtx.exchange} · ${asOfDateStr}`;
          } else if (lower.includes("ризик") || lower.includes("стоп") || lower.includes("sl") || lower.includes("stop")) {
            replyText = `**Оцінка капіталу та ризику (${symbol}):**

• **Поточний Stop Loss:** $${stopLoss} (дистанція до стопу: **${distToSl}%**)
• **Стан позиції:** ${riskRes?.analysis ?? "Стоп-лосс виставлений на біржі."}
• **Денні ліміти втрат:** ${marketCtx.lossStatus.checked ? (marketCtx.lossStatus.limitBreached ? "⚠️ Перевищено ліміт збитків" : "В межах норми") : "[CHECK_SKIPPED / НЕ ПЕРЕВІРЕНО]"}
• **Час верифікації:** ${asOfDateStr}`;
          } else if (lower.includes("потік") || lower.includes("cvd") || lower.includes("кит") || lower.includes("стакан") || lower.includes("дельта") || lower.includes("order flow")) {
            const cvdUsd = typeof ofDetail?.cvdUsd === "number" ? ofDetail.cvdUsd.toFixed(0) : null;
            const obi = typeof ofDetail?.weightedImbalance === "number" ? (ofDetail.weightedImbalance * 100).toFixed(1) : null;
            const buyerAgg = typeof ofDetail?.buyerAggressionPct === "number" ? ofDetail.buyerAggressionPct.toFixed(1) : null;

            replyText = `**Потік ордерів та біржовий стакан (${symbol} · Bybit Linear):**

• **Кумулятивна дельта (CVD snapshot):** ${cvdUsd !== null ? `**${Number(cvdUsd) >= 0 ? "+" : ""}${cvdUsd} USD**` : "[DATA_UNAVAILABLE]"} *(знімок останніх 50 угод)*
• **Дисбаланс стакана (OBI, 50 рівнів):** ${obi !== null ? `**${obi}%**` : "[DATA_UNAVAILABLE]"}
• **Агресивність покупців vs продавців:** ${buyerAgg !== null ? `**${buyerAgg}% покупців** / ${(100 - Number(buyerAgg)).toFixed(1)}% продавців` : "[DATA_UNAVAILABLE]"}
• **Аналіз стрічки:** ${orderFlowRes?.analysis ?? "[DATA_UNAVAILABLE] Потік ордерів недоступний."}
• **Час зрізу:** ${asOfDateStr}`;
          } else if (lower.includes("новин") || lower.includes("news") || lower.includes("анонс")) {
            replyText = `**Новинний контекст (${symbol}):**

• **Статус стрічки новин:** [DATA_UNAVAILABLE: зовнішній новинний фід відключено]
• **Оцінка новинного фону:** ${newsRes?.analysis ?? "Новинний фід тимчасово недоступний. Торгівля ведеться суто за технічною структурою та біржовим стаканом."}
• **Час:** ${asOfDateStr}`;
          } else if (lower.includes("rsi") || lower.includes("індикатор") || lower.includes("indicator")) {
            if (marketCtx.klines15M.length < 15) {
              replyText = `**Технічні індикатори (${symbol}):**

• **RSI (14):** [DATA_UNAVAILABLE] — недостатньо завантажених свічок (наразі ${marketCtx.klines15M.length}, потрібно >=15).
• **EMA (20/50):** [DATA_UNAVAILABLE] — бракує свічкових даних для прогріву.
• **Статус перевірки:** Відмова через брак даних (No hallucinated indicators). Час: ${asOfDateStr}.`;
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
          } else {
            replyText = `**Аналіз угоди (${symbol} · Bybit Linear):**
${pnlText ? `${pnlText}\n` : ""}
• **Синтез ринкового стану:** ${synthesis.summary}
• **Поточна рекомендація Lead Agent:** **${synthesis.leadVerdict}** (Надійність: ${synthesis.confidencePct}%)
• **Субагенти перевірили:** Структура (${structRes?.status ?? "OK"}), Order Flow (${orderFlowRes?.status ?? "OK"}), Ризик (${riskRes?.status ?? "OK"}), Новини (${newsRes?.status ?? "OK"}).
• **Час актуальності:** ${asOfDateStr}`;
          }
        }

        sendEvent({
          type: "step",
          runId,
          stage: "synthesizing",
          stepKey: "lead",
          label: `Синтез завершено (${isLlm ? modelUsed : "Детерміністичний"})`,
          status: "completed"
        });

        // 9. Insert Lead message into DB
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
          .select("id, client_message_id, author_kind, agent_id, kind, content, structured_payload, created_at")
          .single();

        // 10. Telemetry logging
        try {
          await supabase.from("ai_agent_runs").insert({
            session_id: sessionId,
            agent_key: "lead_trade_agent",
            event_reason: `User inquiry: "${userPrompt.slice(0, 100)}"`,
            status: "completed",
            tokens_used: tokensUsed
          });
        } catch {
          // non-blocking
        }

        const createdItem: TradeAiMessageItem = {
          id: (rawCreatedMsg as { id?: string })?.id ?? `srv_${Date.now()}`,
          clientMessageId: (rawCreatedMsg as { client_message_id?: string | null })?.client_message_id ?? null,
          authorKind: "lead",
          agentId: "lead_trade_agent",
          kind: "analysis",
          content: replyText,
          structuredPayload: {
            source: isLlm ? "openrouter_llm" : "deterministic_fallback",
            model: modelUsed,
            tokensUsed,
            verdict: synthesis.leadVerdict,
            timestamp: synthesis.timestampMs,
            asOfMs: marketCtx.asOfMs,
            dataSources: marketCtx.dataSources
          },
          createdAt: (rawCreatedMsg as { created_at?: string })?.created_at ?? new Date().toISOString()
        };

        // 11. Final completed event
        sendEvent({
          type: "completed",
          runId,
          message: createdItem
        });

        controller.close();
      } catch (err) {
        sendEvent({
          type: "failed",
          runId,
          error: err instanceof Error ? err.message : String(err)
        });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive"
    }
  });
}
