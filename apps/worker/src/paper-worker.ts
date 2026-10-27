import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluatePaperTrade,
  type PaperTradeSnapshot,
  type PaperTargetSnapshot
} from "@crypto-bot/trading";
import { logger } from "./logger";

interface DbTrade {
  id: string;
  account_id: string;
  symbol: string;
  side: "long" | "short";
  status: "active" | "entry_open";
  entry_avg: number | null;
  qty: number | null;
  leverage: number | null;
  sl: number | null;
  trailing_stop: Record<string, unknown> | null;
  realized_pnl: number | null;
  exchange_accounts: {
    exchange: string;
    paper_balance: number | null;
  } | null;
}

interface DbTarget {
  id: string;
  idx: number;
  price: number;
  share_pct: number;
  status: "open" | "filled" | "cancelled";
}

async function dispatchTradeAiEvent(
  supabase: SupabaseClient,
  tradeId: string,
  content: string,
  payload?: Record<string, unknown>,
  eventId?: string
): Promise<void> {
  try {
    let { data: session } = await supabase
      .from("trade_ai_sessions")
      .select("id")
      .eq("trade_id", tradeId)
      .maybeSingle();

    if (!session?.id) {
      // Auto-create session if missing so background events are guaranteed delivered
      const { data: trade } = await supabase
        .from("trades")
        .select("id, account_id, symbol, side, entry_avg, sl, exchange_accounts(user_id)")
        .eq("id", tradeId)
        .maybeSingle();

      if (trade) {
        const userId = (trade.exchange_accounts as { user_id?: string } | null)?.user_id;
        if (userId) {
          const tradeSide = typeof trade.side === "string" ? trade.side.toUpperCase() : "LONG";
          const tradeEntry = typeof trade.entry_avg === "number" ? trade.entry_avg.toString() : "—";
          const tradeSl = typeof trade.sl === "number" ? trade.sl.toString() : "—";

          const { data: newSession } = await supabase
            .from("trade_ai_sessions")
            .insert({
              user_id: userId,
              account_id: trade.account_id,
              trade_id: trade.id,
              symbol: trade.symbol,
              status: "active",
              initial_thesis: `Вхід у ${tradeSide} по $${tradeEntry} (SL: $${tradeSl}).`,
              invalidation_criteria: `Пробиття Stop Loss $${tradeSl}.`
            })
            .select("id")
            .single();
          if (newSession?.id) {
            session = newSession;
          }
        }
      }
    }

    if (session?.id) {
      if (eventId) {
        const { data: existing } = await supabase
          .from("trade_ai_messages")
          .select("id")
          .eq("session_id", session.id)
          .eq("event_id", eventId)
          .limit(1)
          .maybeSingle();

        if (existing) return;
      }

      await supabase.from("trade_ai_messages").insert({
        session_id: session.id,
        author_kind: "system",
        kind: "event",
        event_id: eventId ?? null,
        content,
        structured_payload: payload ?? null
      });
    }
  } catch (err) {
    logger.warn({ tradeId, err }, "Failed to dispatch trade AI event");
  }
}

/**
 * 24/7 Paper Matching Engine Background Worker
 * Continuously matches active paper positions against live market prices:
 * - Executes partial TP1 (40%), TP2 (30%), TP3 (30%)
 * - Tracks peak prices and triggers 1% dynamic trailing stop
 * - Executes protective Stop Loss
 * - Honors "manual" mode: pauses automated closures when trader has manual control
 */
export function startPaperWorker(
  supabase: SupabaseClient,
  intervalMs = 3000
): () => void {
  let isRunning = true;
  logger.info({ intervalMs }, "Starting 24/7 Paper Matching Engine Worker...");

  async function checkPaperTrades() {
    try {
      // 1. Fetch all active paper trades
      const { data: rawTrades, error: tradesErr } = await supabase
        .from("trades")
        .select(`
          id, account_id, symbol, side, status, entry_avg, qty, leverage, sl, trailing_stop, realized_pnl,
          exchange_accounts!inner(exchange, paper_balance)
        `)
        .in("status", ["active", "entry_open"]);

      if (tradesErr || !rawTrades || rawTrades.length === 0) return;

      const paperTrades = (rawTrades as unknown as DbTrade[]).filter(
        (t) => t.exchange_accounts?.exchange === "paper" && Number(t.qty ?? 0) > 0
      );

      if (paperTrades.length === 0) return;

      // Group symbols to fetch tickers efficiently
      const symbols = Array.from(new Set(paperTrades.map((t) => t.symbol)));
      const priceMap = new Map<string, number>();

      await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`, {
              headers: { "User-Agent": "Vexqora-Paper-Worker", "Accept": "application/json" }
            });
            if (res.ok) {
              const json = await res.json() as { result?: { list?: Array<{ symbol?: string; lastPrice?: string }> } };
              const item = json.result?.list?.find((x) => x.symbol === symbol) ?? json.result?.list?.[0];
              if (item && (!item.symbol || item.symbol === symbol) && item.lastPrice) {
                const parsedPrice = Number(item.lastPrice);
                if (parsedPrice > 0) {
                  priceMap.set(symbol, parsedPrice);
                }
              }
            }
          } catch {
            // ignore network failure for single symbol
          }
        })
      );

      // Evaluate each paper trade against current price
      for (const trade of paperTrades) {
        const currentPrice = priceMap.get(trade.symbol);
        if (!currentPrice || currentPrice <= 0) continue;

        // Anomaly protection: if price deviates > 15% from entry, skip tick to protect trade
        const entryPrice = Number(trade.entry_avg ?? 0);
        if (entryPrice > 0 && Math.abs(currentPrice - entryPrice) / entryPrice > 0.15) {
          logger.warn({ tradeId: trade.id, symbol: trade.symbol, entryPrice, currentPrice }, "Skipping anomalous price tick > 15% from entry");
          continue;
        }

        const { data: targetsData } = await supabase
          .from("trade_targets")
          .select("id, idx, price, share_pct, status")
          .eq("trade_id", trade.id)
          .order("idx", { ascending: true });

        const targets = (targetsData ?? []) as unknown as DbTarget[];

        const tradeSnapshot: PaperTradeSnapshot = {
          id: trade.id,
          symbol: trade.symbol,
          side: trade.side,
          entry_avg: Number(trade.entry_avg ?? currentPrice),
          qty: Number(trade.qty ?? 0),
          leverage: Number(trade.leverage ?? 5),
          sl: trade.sl !== null ? Number(trade.sl) : null,
          trailing_stop: trade.trailing_stop,
          realized_pnl: Number(trade.realized_pnl ?? 0),
          status: trade.status
        };

        const targetSnapshots: PaperTargetSnapshot[] = targets.map((t) => ({
          id: t.id,
          idx: t.idx,
          price: Number(t.price),
          share_pct: Number(t.share_pct),
          status: t.status
        }));

        const result = evaluatePaperTrade(tradeSnapshot, targetSnapshots, currentPrice);

        // Proactive autonomous companion alerts for active trades (P1.7: DB deduplication via event_id)
        if (tradeSnapshot.status === "active") {
          // 1. Proactive Stop Loss proximity warning (< 1.2% distance)
          if (tradeSnapshot.sl && tradeSnapshot.sl > 0) {
            const isLong = tradeSnapshot.side === "long";
            const distToSl = isLong ? currentPrice - tradeSnapshot.sl : tradeSnapshot.sl - currentPrice;
            const distPct = distToSl / currentPrice;

            if (distPct > 0 && distPct <= 0.012) {
              const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
              const eventId = `sl_warn_${trade.id}_${bucket}`;
              await dispatchTradeAiEvent(
                supabase,
                trade.id,
                `⚠️ **Увага по ризику:** Ціна ${currentPrice} наблизилася до Stop Loss (${tradeSnapshot.sl}) на відстань ${(distPct * 100).toFixed(2)}%! Позиція у зоні підвищеного ризику.`,
                { action: "sl_warning", slPrice: tradeSnapshot.sl, currentPrice, distPct: distPct * 100 },
                eventId
              );
            }
          }

          // 2. Proactive milestone alert: 50% progression toward TP1
          if (targetSnapshots.length > 0 && targetSnapshots[0]?.price && targetSnapshots[0].status === "open") {
            const tp1Price = targetSnapshots[0].price;
            const isLong = tradeSnapshot.side === "long";
            const totalDist = Math.abs(tp1Price - tradeSnapshot.entry_avg);
            if (totalDist > 0) {
              const moved = isLong ? currentPrice - tradeSnapshot.entry_avg : tradeSnapshot.entry_avg - currentPrice;
              const progress = moved / totalDist;
              if (progress >= 0.5 && progress < 0.9) {
                const eventId = `tp1_midway_${trade.id}`;
                await dispatchTradeAiEvent(
                  supabase,
                  trade.id,
                  `📈 **Прогрес угоди:** Подолано 50% дистанції до TP1 (${tp1Price}). Поточна ціна: ${currentPrice}.`,
                  { action: "tp1_midway", progressPct: Math.round(progress * 100), currentPrice },
                  eventId
                );
              }
            }
          }
        }

        if (result.actions.length === 0 || (result.actions.length === 1 && result.actions[0]?.type === "MANUAL_HOLD")) {
          continue;
        }

        if (result.actions.length === 1 && result.actions[0]?.type === "TRAILING_PEAK_UPDATED") {
          await supabase.from("trades").update({
            trailing_stop: result.updatedTrade.trailing_stop
          }).eq("id", trade.id);
          continue;
        }

        logger.info(
          { tradeId: trade.id, symbol: trade.symbol, actionsCount: result.actions.length, deltaPnl: result.totalRealizedPnlDelta },
          "Paper Matching Engine executed actions"
        );

        const allocatedMargin = tradeSnapshot.leverage > 0 && tradeSnapshot.entry_avg > 0
          ? (tradeSnapshot.entry_avg * Number(trade.qty ?? 0)) / tradeSnapshot.leverage
          : Number(trade.qty ?? 0) * tradeSnapshot.entry_avg;

        const safePnlDelta = Math.max(result.totalRealizedPnlDelta, -allocatedMargin);
        const safeNewRealizedPnl = Number(trade.realized_pnl ?? 0) + safePnlDelta;

        const exit = result.updatedTrade.exit;
        const applyResult = await supabase.rpc("apply_paper_trade_result", {
          target_trade_id: trade.id,
          expected_qty: Number(trade.qty ?? 0),
          expected_realized_pnl: Number(trade.realized_pnl ?? 0),
          new_qty: result.updatedTrade.qty,
          new_realized_pnl: safeNewRealizedPnl,
          new_status: result.updatedTrade.status,
          new_trailing_stop: result.updatedTrade.trailing_stop,
          result_closed_at: result.updatedTrade.closed_at ?? null,
          realized_pnl_delta: safePnlDelta,
          target_updates: result.updatedTargets,
          result_exit_reason: exit?.reason ?? null,
          result_exit_price: exit?.price ?? null,
          result_exit_details: exit?.details ?? null
        });

        if (applyResult.error) {
          logger.error({ tradeId: trade.id, error: applyResult.error.message }, "Could not atomically settle paper trade");
          continue;
        }
        if (applyResult.data !== true) {
          logger.info({ tradeId: trade.id }, "Paper event was already settled by another executor");
          continue;
        }

        // Record orders & notifications
        for (const action of result.actions) {
          if (action.type === "TP_FILLED") {
            await supabase.from("orders").insert({
              trade_id: trade.id,
              exchange_order_id: `paper-tp-${action.targetIdx}-${Date.now()}`,
              order_link_id: `paper-tp-${trade.id.slice(0, 8)}-${action.targetIdx}-${Date.now()}`.slice(0, 36),
              type: "limit",
              side: trade.side === "long" ? "sell" : "buy",
              price: action.targetPrice,
              qty: action.closedQty,
              status: "filled",
              reduce_only: true,
              raw: { pnl: action.realizedPnl, remainingQty: action.remainingQty }
            });

            await supabase.from("chat_messages").insert({
              account_id: trade.account_id,
              role: "system",
              kind: "order_event",
              content: `🎯 Paper TP${action.targetIdx} досягнуто! Зафіксовано ${action.closedQty} ${trade.symbol} @ $${action.targetPrice}. Прибуток: +${action.realizedPnl.toFixed(2)} USDT.${action.targetIdx === 1 ? " Трейлінг-стоп активовано (1% від піку)." : ""}`,
              payload: { tradeId: trade.id, symbol: trade.symbol, pnl: action.realizedPnl, targetIdx: action.targetIdx }
            });

            await dispatchTradeAiEvent(
              supabase,
              trade.id,
              `🎯 Біржа підтвердила виконання часткового тейку TP${action.targetIdx}! Зафіксовано ${action.closedQty} ${trade.symbol} @ $${action.targetPrice}. Прибуток: +${action.realizedPnl.toFixed(2)} USDT.${action.targetIdx === 1 ? " Трейлінг-стоп активовано (1% від піку)." : ""}`,
              { action: "tp_filled", targetIdx: action.targetIdx, pnl: action.realizedPnl, price: action.targetPrice }
            );
          } else if (action.type === "TRAILING_STOP_TRIGGERED") {
            await supabase.from("orders").insert({
              trade_id: trade.id,
              exchange_order_id: `paper-trail-${Date.now()}`,
              order_link_id: `paper-trail-${trade.id.slice(0, 8)}-${Date.now()}`.slice(0, 36),
              type: "market",
              side: trade.side === "long" ? "sell" : "buy",
              price: currentPrice,
              qty: action.closedQty,
              status: "filled",
              reduce_only: true,
              raw: { pnl: action.realizedPnl, peakPrice: action.highestPrice ?? action.lowestPrice }
            });

            await supabase.from("chat_messages").insert({
              account_id: trade.account_id,
              role: "system",
              kind: "order_event",
              content: `⚡ Paper Trailing Stop спрацював! Закрито залишок ${action.closedQty} ${trade.symbol} @ $${currentPrice} (відкат 1% від піку $${action.highestPrice ?? action.lowestPrice}). Прибуток: ${action.realizedPnl >= 0 ? "+" : ""}${action.realizedPnl.toFixed(2)} USDT.`,
              payload: { tradeId: trade.id, symbol: trade.symbol, pnl: action.realizedPnl }
            });

            await dispatchTradeAiEvent(
              supabase,
              trade.id,
              `⚡ Trailing Stop спрацював: позицію закрито @ $${currentPrice}. Прибуток: ${action.realizedPnl >= 0 ? "+" : ""}${action.realizedPnl.toFixed(2)} USDT. Post-mortem готовий.`,
              { action: "trailing_stop_triggered", pnl: action.realizedPnl, exitPrice: currentPrice }
            );
          } else if (action.type === "STOP_LOSS_TRIGGERED") {
            await supabase.from("orders").insert({
              trade_id: trade.id,
              exchange_order_id: `paper-sl-${Date.now()}`,
              order_link_id: `paper-sl-${trade.id.slice(0, 8)}-${Date.now()}`.slice(0, 36),
              type: "market",
              side: trade.side === "long" ? "sell" : "buy",
              price: currentPrice,
              qty: action.closedQty,
              status: "filled",
              reduce_only: true,
              raw: { pnl: action.realizedPnl, slPrice: action.slPrice }
            });

            await supabase.from("chat_messages").insert({
              account_id: trade.account_id,
              role: "system",
              kind: "order_event",
              content: `🛑 Paper Stop Loss спрацював для ${trade.symbol} @ $${currentPrice}. Позицію закрито для захисту депозиту. Результат: ${action.realizedPnl.toFixed(2)} USDT.`,
              payload: { tradeId: trade.id, symbol: trade.symbol, pnl: action.realizedPnl }
            });

            await dispatchTradeAiEvent(
              supabase,
              trade.id,
              `🛑 Stop Loss виконано біржею @ $${currentPrice}. Позицію закрито для збереження капіталу. Результат: ${action.realizedPnl.toFixed(2)} USDT. Аналізую root-cause для датасету навчання.`,
              { action: "stop_loss_triggered", pnl: action.realizedPnl, exitPrice: currentPrice }
            );
          } else if (action.type === "ENTRY_FILLED") {
            await supabase.from("trades").update({
              opened_at: new Date().toISOString(),
              status: "active"
            }).eq("id", trade.id);

            await supabase.from("orders").update({
              status: "filled"
            }).eq("trade_id", trade.id).eq("reduce_only", false);

            await supabase.from("chat_messages").insert({
              account_id: trade.account_id,
              role: "system",
              kind: "order_event",
              content: `⚡ Limit вхід для ${trade.symbol} спрацював @ $${action.fillPrice}. Позицію активовано.`,
              payload: { tradeId: trade.id, symbol: trade.symbol, fillPrice: action.fillPrice }
            });

            await dispatchTradeAiEvent(
              supabase,
              trade.id,
              `⚡ Limit вхід підтверджено @ $${action.fillPrice}! Позицію активовано, захисні рівні TP/SL встановлено.`,
              { action: "entry_filled", fillPrice: action.fillPrice }
            );
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Error in Paper Matching Engine worker cycle");
    }
  }

  const timer = setInterval(() => {
    if (isRunning) {
      void checkPaperTrades();
    }
  }, intervalMs);

  return () => {
    isRunning = false;
    clearInterval(timer);
    logger.info("Paper Matching Engine worker stopped");
  };
}
