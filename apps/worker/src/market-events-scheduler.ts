import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";
import { fetchRecentKlines } from "@crypto-bot/exchange";
import { calculateATR } from "@crypto-bot/trading";
import type { Kline } from "@crypto-bot/shared";

interface DbSessionRow {
  id: string;
  user_id: string;
  account_id: string;
  trade_id: string | null;
  signal_id: string | null;
  symbol: string;
  status: string;
  trades?: {
    id: string;
    symbol: string;
    side: "long" | "short";
    entry_avg: number | null;
    sl: number | null;
    tp1: number | null;
    status: string;
  } | null;
  signals?: {
    id: string;
    parsed: Record<string, unknown> | null;
  } | null;
  exchange_accounts?: {
    environment: "demo" | "live";
    exchange: string;
    paper_balance: number | null;
  } | null;
}

/**
 * Persistently records a market event message using DB event_id unique constraint.
 * Returns true if inserted, false if already delivered (deduplicated).
 */
async function recordSessionEvent(
  supabase: SupabaseClient,
  sessionId: string,
  eventId: string,
  content: string,
  payload?: Record<string, unknown>
): Promise<boolean> {
  const { error } = await supabase.from("trade_ai_messages").insert({
    session_id: sessionId,
    author_kind: "system",
    kind: "event",
    event_id: eventId,
    content,
    structured_payload: {
      ...payload,
      source: "event_scheduler",
      eventId,
      timestamp: Date.now()
    }
  });

  if (error) {
    // 23505 is PostgreSQL unique_violation on trade_ai_messages_session_event_idx
    return false;
  }
  return true;
}

/**
 * Evaluates market events across active sessions.
 * Never executes orders autonomously; strictly observes and dispatches grounded intelligence.
 */
export async function evaluateMarketEvents(supabase: SupabaseClient): Promise<void> {
  try {
    const { data: rawSessions, error } = await supabase
      .from("trade_ai_sessions")
      .select("id, user_id, account_id, trade_id, signal_id, symbol, status, trades(id, symbol, side, entry_avg, sl, tp1, status), signals(id, parsed), exchange_accounts(environment, exchange, paper_balance)")
      .eq("status", "active")
      .limit(50);

    if (error || !rawSessions || rawSessions.length === 0) return;

    const sessions = rawSessions as unknown as DbSessionRow[];

    for (const session of sessions) {
      const symbol = session.symbol.toUpperCase();

      // Determine trade parameters
      let side: "long" | "short" = "long";
      let entry = 0;
      let sl = 0;
      let tp1 = 0;

      if (session.trades) {
        if (session.trades.status === "closed" || session.trades.status === "cancelled") {
          // Close session if trade is already closed
          await supabase.from("trade_ai_sessions").update({ status: "closed" }).eq("id", session.id);
          continue;
        }
        side = session.trades.side === "short" ? "short" : "long";
        entry = Number(session.trades.entry_avg ?? 0);
        sl = Number(session.trades.sl ?? 0);
        tp1 = Number(session.trades.tp1 ?? 0);
      } else if (session.signals?.parsed) {
        const parsed = session.signals.parsed;
        if (parsed.side === "short" || parsed.side === "long") side = parsed.side;
        if (typeof parsed.entryPrice === "number") entry = parsed.entryPrice;
        if (typeof parsed.stopLoss === "number") sl = parsed.stopLoss;
        const tps = parsed.takeProfits as Array<{ price?: number }> | undefined;
        if (Array.isArray(tps) && tps[0]?.price) tp1 = tps[0].price;
      }

      const isPaper = session.exchange_accounts?.exchange === "paper" || session.exchange_accounts?.environment === "demo";
      const accountBadge = isPaper ? "Paper/Demo" : "Bybit Live";

      // Fetch 15M klines
      let klines: Kline[] = [];
      try {
        klines = await fetchRecentKlines(symbol, "15", 30);
      } catch {
        continue;
      }

      if (klines.length === 0) continue;
      const currentPrice = klines[klines.length - 1]!.close;
      if (entry === 0) entry = currentPrice;

      // 1. Proactive Stop Loss proximity warning (< 1.2% distance)
      if (sl > 0) {
        const isLong = side === "long";
        const distToSl = isLong ? currentPrice - sl : sl - currentPrice;
        const distPct = (distToSl / currentPrice) * 100;

        if (distPct > 0 && distPct <= 1.2) {
          const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
          const eventId = `sl_prox_${session.id}_${bucket}`;
          const content = `⚠️ **Попередження по ризику (${symbol}):**\n\n• Поточна ціна: **$${currentPrice}** наблизилася до захисного Stop Loss ($${sl}).\n• Дистанція до стопу: **${distPct.toFixed(2)}%**.\n• Режим рахунку: **${accountBadge}**.\n*AI Companion не закриває біржові позиції без ручного підтвердження.*`;
          await recordSessionEvent(supabase, session.id, eventId, content, {
            eventType: "sl_proximity",
            currentPrice,
            slPrice: sl,
            distPct
          });
        }
      }

      // 2. Proactive 50% TP1 progression milestone
      if (tp1 > 0 && entry > 0) {
        const totalDist = Math.abs(tp1 - entry);
        if (totalDist > 0) {
          const isLong = side === "long";
          const moved = isLong ? currentPrice - entry : entry - currentPrice;
          const progress = moved / totalDist;

          if (progress >= 0.5 && progress < 0.95) {
            const eventId = `tp1_midway_${session.id}`;
            const content = `🎯 **Проміжний прогрес (${symbol}):**\n\n• Ціна досягла 50% дистанції до TP1 ($${tp1}).\n• Поточна ціна: **$${currentPrice}** (пройдено ${Math.round(progress * 100)}% шляху до тейку).\n• Нагадування: якщо ви бажаєте зафіксувати частину прибутку, скористайтеся кнопкою [50%] у торговому терміналі.`;
            await recordSessionEvent(supabase, session.id, eventId, content, {
              eventType: "tp1_midway",
              currentPrice,
              tp1Price: tp1,
              progressPct: Math.round(progress * 100)
            });
          }
        }
      }

      // 3. BOS / CHOCH structure shift evaluation (15M)
      if (klines.length >= 10) {
        const lastBar = klines[klines.length - 1]!;
        const prevBars = klines.slice(0, -1);
        const prevSwingHigh = Math.max(...prevBars.map((k) => k.high));
        const prevSwingLow = Math.min(...prevBars.map((k) => k.low));

        if (side === "long" && lastBar.close < prevSwingLow) {
          const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
          const eventId = `struct_shift_${session.id}_bearish_break_${bucket}`;
          const content = `📉 **Структурний зсув ринку (15M для ${symbol}):**\n\n• Зафіксовано **BOS/CHOCH вниз**: закриття свічки нижче локального Swing Low ($${prevSwingLow.toFixed(4)}).\n• Поточна позиція: **LONG**.\n• Рекомендація Risk Guardian: перевірити захисні ордери або перевести стоп ближче до беззбитку.`;
          await recordSessionEvent(supabase, session.id, eventId, content, {
            eventType: "structure_shift",
            shiftType: "bearish_break",
            prevSwingLow,
            closePrice: lastBar.close
          });
        } else if (side === "short" && lastBar.close > prevSwingHigh) {
          const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
          const eventId = `struct_shift_${session.id}_bullish_break_${bucket}`;
          const content = `📈 **Структурний зсув ринку (15M для ${symbol}):**\n\n• Зафіксовано **BOS/CHOCH вгору**: закриття свічки вище локального Swing High ($${prevSwingHigh.toFixed(4)}).\n• Поточна позиція: **SHORT**.\n• Рекомендація Risk Guardian: перевірити захисні ордери або оцінити закриття частини об'єму.`;
          await recordSessionEvent(supabase, session.id, eventId, content, {
            eventType: "structure_shift",
            shiftType: "bullish_break",
            prevSwingHigh,
            closePrice: lastBar.close
          });
        }
      }

      // 4. Volatility Spike (ATR / Price > 3.5%)
      if (klines.length >= 15) {
        const highs = klines.map((k) => k.high);
        const lows = klines.map((k) => k.low);
        const closes = klines.map((k) => k.close);
        const atrValues = calculateATR(highs, lows, closes, 14);
        const currentAtr = atrValues[atrValues.length - 1];
        if (currentAtr && currentPrice > 0) {
          const atrPct = (currentAtr / currentPrice) * 100;
          if (atrPct >= 3.5) {
            const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
            const eventId = `vol_spike_${session.id}_${bucket}`;
            const content = `⚡ **Сплеск волатильності (${symbol}):**\n\n• Показник ATR(14) зріс до **${atrPct.toFixed(2)}%** від ціни ($${currentAtr.toFixed(4)}).\n• Можливі різкі цінові сквизи та розширення спреду. Рекомендується контролювати ризик.`;
            await recordSessionEvent(supabase, session.id, eventId, content, {
              eventType: "volatility_spike",
              atr: currentAtr,
              atrPct
            });
          }
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Error in market events scheduler cycle");
  }
}

/**
 * Starts 24/7 background Market Events Scheduler in Worker.
 */
export function startMarketEventsScheduler(
  supabase: SupabaseClient,
  intervalMs = 12000
): () => void {
  logger.info({ intervalMs }, "Starting 24/7 Market Events Scheduler for AI Companion...");

  let isRunning = true;

  const cycle = async () => {
    if (!isRunning) return;
    await evaluateMarketEvents(supabase);
    if (isRunning) {
      setTimeout(() => void cycle(), intervalMs);
    }
  };

  void cycle();

  return () => {
    logger.info("Stopping Market Events Scheduler...");
    isRunning = false;
  };
}
