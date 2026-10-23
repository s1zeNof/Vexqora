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
              const json = await res.json() as { result?: { list?: Array<{ lastPrice?: string }> } };
              const last = json.result?.list?.[0]?.lastPrice;
              if (last) {
                priceMap.set(symbol, Number(last));
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

        // Update trade row
        await supabase.from("trades").update({
          qty: result.updatedTrade.qty,
          realized_pnl: result.updatedTrade.realized_pnl,
          status: result.updatedTrade.status,
          trailing_stop: result.updatedTrade.trailing_stop,
          ...(result.updatedTrade.closed_at ? { closed_at: result.updatedTrade.closed_at } : {})
        }).eq("id", trade.id);

        // Update targets
        for (const ut of result.updatedTargets) {
          await supabase.from("trade_targets").update({
            status: ut.status,
            ...(ut.filled_at ? { filled_at: ut.filled_at } : {})
          }).eq("id", ut.id);
        }

        // Credit virtual paper balance
        if (result.totalRealizedPnlDelta !== 0 && trade.exchange_accounts) {
          const currentBal = Number(trade.exchange_accounts.paper_balance ?? 10000);
          const newBal = Math.max(0, currentBal + result.totalRealizedPnlDelta);
          await supabase.from("exchange_accounts").update({
            paper_balance: newBal
          }).eq("id", trade.account_id);
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
