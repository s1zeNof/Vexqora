import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  evaluatePaperTrade,
  type PaperTradeSnapshot,
  type PaperTargetSnapshot,
  type PaperEvaluationResult
} from "@crypto-bot/trading";

const trailingStopSchema = z.object({
  distance: z.object({
    type: z.enum(["percent", "absolute"]),
    value: z.number()
  }).optional(),
  activationPrice: z.number().optional(),
  highestPrice: z.number().optional(),
  lowestPrice: z.number().optional(),
  activated: z.boolean().optional(),
  controlMode: z.enum(["auto", "manual"]).optional(),
  initialQty: z.number().optional()
}).passthrough().nullable().optional();

const dbTradeSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  status: z.enum(["active", "entry_open", "closed", "cancelled", "failed"]),
  entry_avg: z.union([z.number(), z.string(), z.null()]).optional(),
  qty: z.union([z.number(), z.string(), z.null()]).optional(),
  leverage: z.union([z.number(), z.string(), z.null()]).optional(),
  sl: z.union([z.number(), z.string(), z.null()]).optional(),
  trailing_stop: trailingStopSchema,
  realized_pnl: z.union([z.number(), z.string(), z.null()]).optional()
}).passthrough();

const dbAccountSchema = z.object({
  id: z.string(),
  exchange: z.string(),
  paper_balance: z.union([z.number(), z.string(), z.null()]).optional()
}).passthrough();

const dbTargetSchema = z.object({
  id: z.string(),
  idx: z.number(),
  price: z.union([z.number(), z.string()]),
  share_pct: z.union([z.number(), z.string()]),
  status: z.enum(["open", "filled", "cancelled"])
});

/**
 * Process a price tick for an active paper trading position.
 * Evaluates TP1-3 partial fills, dynamic trailing stop, and SL.
 * Credits realized PnL to virtual paper balance and creates audit events.
 */
export async function processPaperTradeTick(
  supabase: SupabaseClient,
  tradeId: string,
  currentPrice: number
): Promise<PaperEvaluationResult | null> {
  if (!currentPrice || currentPrice <= 0) return null;

  // 1. Fetch trade
  const { data: rawTradeData, error: tradeErr } = await supabase
    .from("trades")
    .select("id, account_id, symbol, side, status, entry_avg, qty, leverage, sl, trailing_stop, realized_pnl")
    .eq("id", tradeId)
    .maybeSingle();

  if (tradeErr || !rawTradeData) return null;
  const tradeParsed = dbTradeSchema.safeParse(rawTradeData);
  if (!tradeParsed.success) {
    console.error("[PaperService] dbTradeSchema parse error:", tradeParsed.error.issues);
    return null;
  }
  const trade = tradeParsed.data;

  if (trade.status !== "active" && trade.status !== "entry_open") {
    return null;
  }

  // 2. Fetch account to ensure it's a paper account
  const { data: rawAccData, error: accErr } = await supabase
    .from("exchange_accounts")
    .select("id, exchange, paper_balance")
    .eq("id", trade.account_id)
    .maybeSingle();

  if (accErr || !rawAccData) return null;
  const accParsed = dbAccountSchema.safeParse(rawAccData);
  if (!accParsed.success) {
    console.error("[PaperService] dbAccountSchema parse error:", accParsed.error.issues);
    return null;
  }
  const account = accParsed.data;

  if (account.exchange !== "paper") {
    // Only paper trades are evaluated by this emulator
    return null;
  }

  // 3. Fetch trade targets
  const { data: rawTargetData } = await supabase
    .from("trade_targets")
    .select("id, trade_id, idx, price, share_pct, status")
    .eq("trade_id", trade.id)
    .order("idx", { ascending: true });

  const rawTargets = Array.isArray(rawTargetData) ? rawTargetData : [];
  const targets = rawTargets
    .map((t) => dbTargetSchema.safeParse(t))
    .filter((p): p is { success: true; data: z.infer<typeof dbTargetSchema> } => p.success)
    .map((p) => p.data);

  const tradeSnapshot: PaperTradeSnapshot = {
    id: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    entry_avg: Number(trade.entry_avg ?? currentPrice),
    qty: Number(trade.qty ?? 0),
    leverage: Number(trade.leverage ?? 5),
    sl: trade.sl !== null && trade.sl !== undefined ? Number(trade.sl) : null,
    trailing_stop: trade.trailing_stop ?? null,
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

  // 4. Evaluate using the pure Paper Matching Engine
  const result = evaluatePaperTrade(tradeSnapshot, targetSnapshots, currentPrice);

  // If no action or changes occurred, return early
  if (result.actions.length === 0 || (result.actions.length === 1 && result.actions[0]?.type === "MANUAL_HOLD")) {
    return result;
  }

  // If only trailing peak was updated
  if (result.actions.length === 1 && result.actions[0]?.type === "TRAILING_PEAK_UPDATED") {
    await supabase.from("trades").update({
      trailing_stop: result.updatedTrade.trailing_stop
    }).eq("id", trade.id).eq("qty", Number(trade.qty ?? 0));
    return result;
  }

  // 5. Atomically persist the trade, targets and balance.
  // Isolated Margin Guard: A paper position loss can NEVER exceed the allocated position margin
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

  if (applyResult.error) throw new Error(`Could not settle paper trade: ${applyResult.error.message}`);
  if (applyResult.data !== true) return null;

  // Record orders & notifications for each action
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
        raw: { pnl: action.realizedPnl, peakPrice: action.highestPrice ?? action.lowestPrice ?? currentPrice }
      });

      await supabase.from("chat_messages").insert({
        account_id: trade.account_id,
        role: "system",
        kind: "order_event",
        content: `⚡ Paper Trailing Stop спрацював! Закрито залишок ${action.closedQty} ${trade.symbol} @ $${currentPrice} (відкат 1% від піку $${action.highestPrice ?? action.lowestPrice ?? currentPrice}). Прибуток: ${action.realizedPnl >= 0 ? "+" : ""}${action.realizedPnl.toFixed(2)} USDT.`,
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

  return result;
}
