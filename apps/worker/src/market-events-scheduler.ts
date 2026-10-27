import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";
import {
  fetchRecentKlines,
  fetchOrderBook,
  fetchRecentTrades
} from "@crypto-bot/exchange";
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
    qty: number | null;
    leverage?: number | null;
    realized_pnl?: number | null;
    exit_reason?: string | null;
    exit_price?: number | null;
    closed_at?: string | null;
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
    // Unique constraint violation (trade_ai_messages_session_event_idx) -> already sent
    return false;
  }
  return true;
}

/**
 * P0.4: Evaluates autonomous market events across active sessions.
 * Never executes orders autonomously; strictly observes and dispatches grounded intelligence.
 */
export async function evaluateMarketEvents(supabase: SupabaseClient): Promise<void> {
  try {
    const { data: rawSessions, error } = await supabase
      .from("trade_ai_sessions")
      .select("id, user_id, account_id, trade_id, signal_id, symbol, status, trades(id, symbol, side, entry_avg, sl, tp1, qty, leverage, realized_pnl, exit_reason, exit_price, closed_at, status), signals(id, parsed), exchange_accounts(environment, exchange, paper_balance)")
      .eq("status", "active")
      .limit(50);

    if (error || !rawSessions || rawSessions.length === 0) return;

    const sessions = rawSessions as unknown as DbSessionRow[];

    for (const session of sessions) {
      const symbol = session.symbol.toUpperCase();

      // Handle Post-Trade Analysis when trade is closed
      if (session.trades && (session.trades.status === "closed" || session.trades.status === "cancelled")) {
        const closedTrade = session.trades;
        const eventId = `post_trade_${closedTrade.id}`;
        const pnl = Number(closedTrade.realized_pnl ?? 0);
        const exitReason = closedTrade.exit_reason ?? "manual";
        const exitPrice = closedTrade.exit_price ? `$${Number(closedTrade.exit_price).toFixed(2)}` : "по ринку";

        const postMortemContent = `🏁 **Завершення угоди та Post-Mortem аналіз (${symbol}):**\n\n` +
          `• **Фінансовий результат:** **${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT**\n` +
          `• **Причина закриття:** **${exitReason.toUpperCase()}** (${exitPrice})\n` +
          `• **Висновки для пам'яті моделі:** ${
            pnl > 0
              ? "Угода відпрацювала позитивно за запланованим сценарієм прибутку. Рівні тейк-профіту та супровід виявилися точними."
              : exitReason === "sl" || exitReason === "stop_loss"
              ? "Спрацював захисний Stop Loss. Ризик обмежено згідно з правилами капіталу. Поточний ринковий контекст враховано для наступних адаптацій."
              : "Позицію закрито завчасно за ручним рішенням або трейлінг-стопом."
          }\n` +
          `*Сесію AI Companion для цієї угоди архівовано.*`;

        const recorded = await recordSessionEvent(supabase, session.id, eventId, postMortemContent, {
          eventType: "post_trade_analysis",
          pnl,
          exitReason,
          exitPrice: closedTrade.exit_price,
          severity: pnl >= 0 ? "info" : "warning"
        });

        if (recorded) {
          await supabase.from("trade_ai_sessions").update({ status: "closed" }).eq("id", session.id);
        }
        continue;
      }

      // Determine trade parameters
      let side: "long" | "short" = "long";
      let entry = 0;
      let sl = 0;
      let tp1 = 0;

      if (session.trades) {
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

      // 1. Fetch 15M klines
      let klines15M: Kline[] = [];
      try {
        klines15M = await fetchRecentKlines(symbol, "15", 30);
      } catch {
        continue;
      }

      if (klines15M.length === 0) continue;
      const currentPrice = klines15M[klines15M.length - 1]!.close;
      if (entry === 0) entry = currentPrice;

      // 2. Proactive Stop Loss proximity warning (< 1.2% distance)
      if (sl > 0) {
        const isLong = side === "long";
        const distToSl = isLong ? currentPrice - sl : sl - currentPrice;
        const distPct = (distToSl / currentPrice) * 100;

        if (distPct > 0 && distPct <= 1.2) {
          const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
          const eventId = `sl_prox_${session.id}_${bucket}`;
          const content = `⚠️ **Попередження по ризику (${symbol}):**\n\n` +
            `• Поточна ціна: **$${currentPrice}** наблизилася до захисного Stop Loss ($${sl}).\n` +
            `• Дистанція до стопу: **${distPct.toFixed(2)}%**.\n` +
            `• Режим рахунку: **${accountBadge}**.\n` +
            `• **Сценарій дії:** Рекомендується перевірити біржові ордери або розглянути зменшення ризику.\n` +
            `*AI Companion не закриває біржові позиції без ручного підтвердження.*`;

          await recordSessionEvent(supabase, session.id, eventId, content, {
            eventType: "sl_proximity",
            currentPrice,
            slPrice: sl,
            distPct,
            severity: "critical"
          });
        }
      }

      // 3. Proactive 50% TP1 progression milestone
      if (tp1 > 0 && entry > 0) {
        const totalDist = Math.abs(tp1 - entry);
        if (totalDist > 0) {
          const isLong = side === "long";
          const moved = isLong ? currentPrice - entry : entry - currentPrice;
          const progress = moved / totalDist;

          if (progress >= 0.5 && progress < 0.95) {
            const eventId = `tp1_midway_${session.id}`;
            const content = `🎯 **Проміжний прогрес (${symbol}):**\n\n` +
              `• Ціна досягла 50% дистанції до TP1 ($${tp1}).\n` +
              `• Поточна ціна: **$${currentPrice}** (пройдено **${Math.round(progress * 100)}%** шляху до тейку).\n` +
              `• **Сценарій дії:** Якщо ви бажаєте зафіксувати частину прибутку або перевести позицію в безубиток — скористайтеся кнопкою [50%] у торговому терміналі.`;

            await recordSessionEvent(supabase, session.id, eventId, content, {
              eventType: "tp1_midway",
              currentPrice,
              tp1Price: tp1,
              progressPct: Math.round(progress * 100),
              severity: "info"
            });
          }
        }
      }

      // 4. BOS / CHOCH structure shift evaluation (15M)
      if (klines15M.length >= 10) {
        const lastBar = klines15M[klines15M.length - 1]!;
        const prevBars = klines15M.slice(0, -1);
        const prevSwingHigh = Math.max(...prevBars.map((k) => k.high));
        const prevSwingLow = Math.min(...prevBars.map((k) => k.low));

        if (side === "long" && lastBar.close < prevSwingLow) {
          const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
          const eventId = `struct_shift_${session.id}_bearish_break_${bucket}`;
          const content = `📉 **Структурний зсув ринку (15M для ${symbol}):**\n\n` +
            `• Зафіксовано **BOS/CHOCH вниз**: закриття свічки ($${lastBar.close}) нижче локального Swing Low ($${prevSwingLow.toFixed(4)}).\n` +
            `• Поточна позиція: **LONG**.\n` +
            `• **Причина та сценарій:** Продавці подолали ключову підтримку 15M. Підвищений ризик подальшої ліквідації ліквідності у discount зону. Рекомендується перевірити Stop Loss.`;

          await recordSessionEvent(supabase, session.id, eventId, content, {
            eventType: "structure_shift",
            shiftType: "bearish_break",
            prevSwingLow,
            closePrice: lastBar.close,
            severity: "warning"
          });
        } else if (side === "short" && lastBar.close > prevSwingHigh) {
          const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
          const eventId = `struct_shift_${session.id}_bullish_break_${bucket}`;
          const content = `📈 **Структурний зсув ринку (15M для ${symbol}):**\n\n` +
            `• Зафіксовано **BOS/CHOCH вгору**: закриття свічки ($${lastBar.close}) вище локального Swing High ($${prevSwingHigh.toFixed(4)}).\n` +
            `• Поточна позиція: **SHORT**.\n` +
            `• **Причина та сценарій:** Покупці пробили локальний опір 15M. Підвищений ризик шорт-сквізу. Рекомендується оцінити закриття частини об'єму.`;

          await recordSessionEvent(supabase, session.id, eventId, content, {
            eventType: "structure_shift",
            shiftType: "bullish_break",
            prevSwingHigh,
            closePrice: lastBar.close,
            severity: "warning"
          });
        }
      }

      // 5. Volatility Spike (ATR / Price > 3.5%)
      if (klines15M.length >= 15) {
        const highs = klines15M.map((k) => k.high);
        const lows = klines15M.map((k) => k.low);
        const closes = klines15M.map((k) => k.close);
        const atrValues = calculateATR(highs, lows, closes, 14);
        const currentAtr = atrValues[atrValues.length - 1];
        if (currentAtr && currentPrice > 0) {
          const atrPct = (currentAtr / currentPrice) * 100;
          if (atrPct >= 3.5) {
            const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
            const eventId = `vol_spike_${session.id}_${bucket}`;
            const content = `⚡ **Сплеск волатильності (${symbol}):**\n\n` +
              `• Показник ATR(14) зріс до **${atrPct.toFixed(2)}%** від ціни ($${currentAtr.toFixed(4)}).\n` +
              `• **Сценарій:** Можливі різкі цінові виноси ліквідності та розширення спреду. Рекомендується дотримуватися плану ризик-менеджменту.`;

            await recordSessionEvent(supabase, session.id, eventId, content, {
              eventType: "volatility_spike",
              atr: currentAtr,
              atrPct,
              severity: "warning"
            });
          }
        }
      }

      // 6. Multi-Timeframe (MTF) Trend Conflict (15M vs 4H)
      try {
        const klines4H = await fetchRecentKlines(symbol, "240", 25);
        if (klines4H.length >= 10 && klines15M.length >= 10) {
          const last4H = klines4H[klines4H.length - 1]!;
          const prev4H = klines4H[klines4H.length - 5]!;
          const trend4HIsBullish = last4H.close > prev4H.close;
          const trend15MIsBullish = klines15M[klines15M.length - 1]!.close > klines15M[klines15M.length - 5]!.close;

          // Conflict: User entered Long, 15M is bullish, but 4H macro trend is strongly bearish
          if (side === "long" && trend15MIsBullish && !trend4HIsBullish) {
            const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
            const eventId = `mtf_conflict_${session.id}_4h_bear_${bucket}`;
            const content = `⚠️ **Конфлікт таймфреймів (MTF для ${symbol}):**\n\n` +
              `• Короткостроковий імпульс 15M висхідний, проте **старший тренд 4H залишається спадним**.\n` +
              `• **Сценарій:** Поточний ріст може бути корекційним тестом FVG або ведмежого блоку замовлень (Order Block) на 4H, після чого можливе продовження спадного руху. Не перетримуйте позицію понад запланований TP1.`;

            await recordSessionEvent(supabase, session.id, eventId, content, {
              eventType: "mtf_conflict",
              timeframes: "15M_vs_4H",
              severity: "warning"
            });
          } else if (side === "short" && !trend15MIsBullish && trend4HIsBullish) {
            const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
            const eventId = `mtf_conflict_${session.id}_4h_bull_${bucket}`;
            const content = `⚠️ **Конфлікт таймфреймів (MTF для ${symbol}):**\n\n` +
              `• Короткостроковий рух 15M спадний, проте **старший тренд 4H залишається висхідним**.\n` +
              `• **Сценарій:** Поточне зниження може бути зняттям ліквідності у discount зону на 4H з наступним відскоком. Контролюйте захисний Stop Loss.`;

            await recordSessionEvent(supabase, session.id, eventId, content, {
              eventType: "mtf_conflict",
              timeframes: "15M_vs_4H",
              severity: "warning"
            });
          }
        }
      } catch {
        // MTF check fallback
      }

      // 7. Order Flow & CVD Aggression Shifts (Bybit L2 Depth & Tape)
      try {
        const [ob, trades] = await Promise.all([
          fetchOrderBook(symbol, 50).catch(() => null),
          fetchRecentTrades(symbol, 50).catch(() => [])
        ]);

        if (ob && trades.length >= 20) {
          const buyTrades = trades.filter((t) => t.side === "Buy");
          const totalVol = trades.reduce((sum, t) => sum + (t.price * t.size), 0);
          const buyVol = buyTrades.reduce((sum, t) => sum + (t.price * t.size), 0);
          const buyerAggressionPct = totalVol > 0 ? (buyVol / totalVol) * 100 : 50;

          const totalBidSize = ob.bids.slice(0, 25).reduce((acc, l) => acc + l.size, 0);
          const totalAskSize = ob.asks.slice(0, 25).reduce((acc, l) => acc + l.size, 0);
          const imbalance = (totalBidSize + totalAskSize) > 0
            ? (totalBidSize - totalAskSize) / (totalBidSize + totalAskSize)
            : 0;

          // Severe aggression against Long position
          if (side === "long" && buyerAggressionPct < 30 && imbalance < -0.35) {
            const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
            const eventId = `of_shift_${session.id}_sell_agg_${bucket}`;
            const content = `🌊 **Тиск продавців у стакані (Order Flow для ${symbol}):**\n\n` +
              `• Зафіксовано агресивний продаж маркетом: покупці становлять лише **${buyerAggressionPct.toFixed(1)}%** стрічки угод.\n` +
              `• Дисбаланс стакана (OBI): **${(imbalance * 100).toFixed(1)}%** на користь стінок на продаж (Asks).\n` +
              `• **Сценарій:** Локальне домінування ведмедів у біржовому стакані Bybit. Рекомендується пильно спостерігати за поведінкою ціни біля підтримки.`;

            await recordSessionEvent(supabase, session.id, eventId, content, {
              eventType: "order_flow_aggression",
              buyerAggressionPct,
              imbalance,
              severity: "warning"
            });
          } else if (side === "short" && buyerAggressionPct > 70 && imbalance > 0.35) {
            const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
            const eventId = `of_shift_${session.id}_buy_agg_${bucket}`;
            const content = `🌊 **Тиск покупців у стакані (Order Flow для ${symbol}):**\n\n` +
              `• Зафіксовано агресивний викуп маркетом: покупці становлять **${buyerAggressionPct.toFixed(1)}%** стрічки угод.\n` +
              `• Дисбаланс стакана (OBI): **+${(imbalance * 100).toFixed(1)}%** на користь заявок на купівлю (Bids).\n` +
              `• **Сценарій:** Локальне домінування биків. Підвищений ризик продавлювання вашої шорт-позиції.`;

            await recordSessionEvent(supabase, session.id, eventId, content, {
              eventType: "order_flow_aggression",
              buyerAggressionPct,
              imbalance,
              severity: "warning"
            });
          }
        }
      } catch {
        // Order flow check fallback
      }

      // 8. Abnormal Volume Spike (15M volume > 2.5x 10-bar average)
      if (klines15M.length >= 12) {
        const lastBar = klines15M[klines15M.length - 1]!;
        const prevBars = klines15M.slice(-11, -1);
        const avgVol = prevBars.reduce((sum, b) => sum + b.volume, 0) / prevBars.length;

        if (avgVol > 0 && lastBar.volume >= avgVol * 2.5) {
          const ratio = (lastBar.volume / avgVol) * 100 - 100;
          const bucket = Math.floor(Date.now() / (45 * 60 * 1000));
          const eventId = `vol_spike_${session.id}_${bucket}`;
          const content = `📊 **Аномальний сплеск торгового обсягу (${symbol}):**\n\n` +
            `• Обсяг поточної 15M свічки перевищив середній рівень на **+${ratio.toFixed(0)}%**.\n` +
            `• Поточна ціна: **$${currentPrice}**.\n` +
            `• **Сценарій:** Заходження значної ліквідності або фіксація великих позицій. Очікується імпульсне розширення діапазону.`;

          await recordSessionEvent(supabase, session.id, eventId, content, {
            eventType: "volume_spike",
            volume: lastBar.volume,
            avgVolume: avgVol,
            severity: "info"
          });
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
  intervalMs = 15000
): () => void {
  logger.info({ intervalMs }, "Starting 24/7 Autonomous Market Events Scheduler for AI Companion...");

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
    logger.info("Stopping Autonomous Market Events Scheduler...");
    isRunning = false;
  };
}
