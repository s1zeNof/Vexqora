import { createBybitClient, decryptSecret } from "@crypto-bot/exchange";
import type { ExchangeAccountRow, ExchangeClient, Signal, UserEvent } from "@crypto-bot/shared";
import { protectFilledPosition, type TradePreview } from "@crypto-bot/trading";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";
import { sendDiscordAlert } from "./notifications";

interface BybitOrderPayload {
  symbol?: string;
  orderId?: string;
  orderLinkId?: string;
  orderStatus?: string;
  avgPrice?: string;
  price?: string;
  cumExecQty?: string;
  reduceOnly?: boolean;
  side?: string;
}

interface BybitPositionPayload {
  symbol?: string;
  size?: string;
  side?: string;
}

interface UserStreamEventPayload {
  topic?: string;
  data?: unknown[];
}

interface DbTradeRow {
  id: string;
  symbol: string;
  side: "long" | "short";
  status: string;
  qty: number;
  sl: number | null;
  leverage: number | null;
  signals?: { parsed?: Signal } | null;
}

export async function handleBybitUserEvent(
  supabase: SupabaseClient,
  client: ExchangeClient,
  account: { id: string; label: string },
  event: UserEvent,
  discordWebhook?: string
): Promise<void> {
  if (event.type !== "bybit") return;

  const payload = event.payload as UserStreamEventPayload | undefined;
  if (!payload || !payload.topic || !Array.isArray(payload.data)) return;

  // 1. Order status changes (Entry fills, TP fills, Cancellations)
  if (payload.topic === "order") {
    for (const item of payload.data) {
      const order = item as BybitOrderPayload;
      if (!order.orderId && !order.orderLinkId) continue;

      logger.info({
        account: account.label,
        symbol: order.symbol,
        orderId: order.orderId,
        orderStatus: order.orderStatus,
        reduceOnly: order.reduceOnly
      }, "Received Bybit WebSocket order event");

      // Locate corresponding order in database
      let query = supabase.from("orders").select("id, trade_id, reduce_only, type, status, raw");
      if (order.orderLinkId) {
        query = query.eq("order_link_id", order.orderLinkId);
      } else {
        query = query.eq("exchange_order_id", order.orderId!);
      }

      const orderLookupRes = await query.maybeSingle();
      if (orderLookupRes.error || !orderLookupRes.data) continue;
      const orderRow = orderLookupRes.data;

      // Handle Entry Order Fills (status = "entry_open" -> "active")
      if (!orderRow.reduce_only && (order.orderStatus === "Filled" || order.orderStatus === "PartiallyFilled")) {
        const tradeRes = await supabase
          .from("trades")
          .select("id, symbol, side, status, qty, sl, leverage, signals(parsed)")
          .eq("id", orderRow.trade_id)
          .single();

        if (tradeRes.error || !tradeRes.data) continue;
        const trade = tradeRes.data as unknown as DbTradeRow;

        if (trade.status === "entry_open") {
          const fillPrice = Number(order.avgPrice) || Number(order.price) || 0;
          logger.info({ tradeId: trade.id, symbol: trade.symbol, fillPrice }, "Entry order filled. Transitioning trade to active and placing SL/TP protection.");

          await supabase.from("trades").update({
            status: "active",
            entry_avg: fillPrice > 0 ? fillPrice : undefined,
            opened_at: new Date().toISOString()
          }).eq("id", trade.id);

          await supabase.from("orders").update({
            status: order.orderStatus === "Filled" ? "filled" : "partially_filled",
            price: fillPrice > 0 ? fillPrice : undefined
          }).eq("id", orderRow.id);

          // Retrieve or reconstruct TradePreview for protection
          const rawData: unknown = orderRow.raw;
          let preview: TradePreview | undefined = (rawData as { preview?: TradePreview } | null)?.preview;

          if (!preview) {
            const signalData = trade.signals?.parsed;
            if (signalData) {
              const instrument = await client.getInstrument(trade.symbol);
              preview = {
                signal: signalData,
                entryPrice: fillPrice,
                qty: Number(trade.qty),
                qtyStep: instrument.qtyStep,
                tickSize: instrument.tickSize,
                notional: fillPrice * Number(trade.qty),
                riskAmount: 0,
                riskPct: 0,
                leverage: Number(trade.leverage) || 1,
                weightedRewardRisk: 1
              };
            }
          }

          if (preview) {
            try {
              const protection = await protectFilledPosition(client, preview, trade.id);

              for (const [idx, tpOrder] of protection.takeProfitOrders.entries()) {
                const target = preview.signal.takeProfits[idx];
                if (target) {
                  await supabase.from("trade_targets").insert({
                    trade_id: trade.id,
                    idx: idx + 1,
                    price: target.price,
                    share_pct: target.sharePct,
                    status: "open",
                    order_id: tpOrder.orderId
                  });

                  await supabase.from("orders").insert({
                    trade_id: trade.id,
                    exchange_order_id: tpOrder.orderId,
                    order_link_id: tpOrder.orderLinkId ?? `tp-${trade.id}-${idx + 1}`,
                    type: "limit",
                    side: trade.side === "long" ? "sell" : "buy",
                    price: target.price,
                    qty: (preview.qty * target.sharePct) / 100,
                    status: "submitted",
                    reduce_only: true
                  });
                }
              }

              await supabase.from("chat_messages").insert({
                account_id: account.id,
                role: "system",
                kind: "order_event",
                content: `Limit entry filled for ${trade.symbol} @ ${fillPrice}. Stop Loss set at ${trade.sl ?? "—"}. ${protection.takeProfitOrders.length} TP targets placed on Bybit.`,
                payload: { tradeId: trade.id, symbol: trade.symbol, entryPrice: fillPrice, sl: trade.sl }
              });

              await sendDiscordAlert(discordWebhook, {
                title: `Limit Entry Filled: ${trade.symbol}`,
                description: `Limit order filled at ${fillPrice}. Position is now active and protected with Stop Loss at ${trade.sl ?? "—"}.`,
                symbol: trade.symbol,
                side: trade.side,
                price: fillPrice,
                qty: Number(trade.qty)
              });
            } catch (protErr) {
              logger.error({ tradeId: trade.id, err: protErr }, "Failed to place protection after WebSocket limit entry fill");
            }
          }
        }
      }

      // Handle Take Profit Target Fills (reduce_only = true and Filled)
      if (orderRow.reduce_only && order.orderStatus === "Filled" && order.orderId) {
        const targetRes = await supabase
          .from("trade_targets")
          .select("id, trade_id, idx, price")
          .eq("order_id", order.orderId)
          .maybeSingle();

        if (!targetRes.error && targetRes.data) {
          const targetId = String(targetRes.data.id);
          const targetTradeId = String(targetRes.data.trade_id);
          const targetIdx = Number(targetRes.data.idx);
          const targetPrice = Number(targetRes.data.price);

          await supabase.from("trade_targets").update({
            status: "filled",
            filled_at: new Date().toISOString()
          }).eq("id", targetId);

          await supabase.from("orders").update({
            status: "filled"
          }).eq("id", orderRow.id);

          const filledTargetPrice = order.avgPrice ? Number(order.avgPrice) : targetPrice;

          await supabase.from("chat_messages").insert({
            account_id: account.id,
            role: "system",
            kind: "order_event",
            content: `Take Profit #${targetIdx} hit for trade at ${filledTargetPrice}!`,
            payload: { tradeId: targetTradeId, targetIdx, price: filledTargetPrice }
          });

          // Check if any open targets remain
          const openTargetsRes = await supabase
            .from("trade_targets")
            .select("id")
            .eq("trade_id", targetTradeId)
            .eq("status", "open");

          const openTargets = (openTargetsRes.data ?? []) as unknown as Array<{ id: string }>;

          if (openTargets.length === 0) {
            await supabase.from("trades").update({
              status: "closed",
              closed_at: new Date().toISOString()
            }).eq("id", targetTradeId);

            await supabase.from("chat_messages").insert({
              account_id: account.id,
              role: "system",
              kind: "order_event",
              content: `All Take Profit targets achieved! Position successfully closed.`,
              payload: { tradeId: targetTradeId }
            });
          }
        }
      }

      // Handle Order Cancellation
      if (order.orderStatus === "Cancelled") {
        await supabase.from("orders").update({ status: "cancelled" }).eq("id", orderRow.id);
        if (!orderRow.reduce_only) {
          await supabase.from("trades").update({ status: "cancelled" }).eq("id", orderRow.trade_id).eq("status", "entry_open");
        }
      }
    }
  }

  // 2. Position size changes (Stop Loss triggered or position closed on exchange)
  if (payload.topic === "position") {
    for (const item of payload.data) {
      const pos = item as BybitPositionPayload;
      if (pos.symbol && Number(pos.size) === 0) {
        // Position was completely closed on exchange
        const activeTradesRes = await supabase
          .from("trades")
          .select("id, symbol")
          .eq("account_id", account.id)
          .eq("symbol", pos.symbol)
          .eq("status", "active");

        const activeTrades = (activeTradesRes.data ?? []) as unknown as Array<{ id: string; symbol: string }>;

        if (activeTrades.length > 0) {
          for (const trade of activeTrades) {
            logger.info({ tradeId: trade.id, symbol: trade.symbol }, "Position closed on exchange. Updating DB status to closed.");
            await supabase.from("trades").update({
              status: "closed",
              closed_at: new Date().toISOString()
            }).eq("id", trade.id);

            // Cancel any remaining open TP limit orders
            try {
              const openOrders = await client.getOpenOrders(trade.symbol);
              for (const o of openOrders) {
                await client.cancelOrder(trade.symbol, o.orderId);
              }
            } catch (cancelErr) {
              logger.warn({ tradeId: trade.id, err: cancelErr }, "Error cancelling remaining orders after position closure");
            }

            await supabase.from("trade_targets").update({ status: "cancelled" }).eq("trade_id", trade.id).eq("status", "open");

            await supabase.from("chat_messages").insert({
              account_id: account.id,
              role: "system",
              kind: "order_event",
              content: `Position for ${trade.symbol} closed on Bybit (Stop Loss / Market Exit). Open targets cancelled.`,
              payload: { tradeId: trade.id, symbol: trade.symbol }
            });
          }
        }
      }
    }
  }
}

export function startWsListener(
  supabase: SupabaseClient,
  masterKey: string,
  discordWebhook?: string
): () => void {
  logger.info("Initializing Bybit Private WebSocket Listener Manager...");
  const activeStreams = new Map<string, () => void>();
  let isRunning = true;

  async function syncStreams() {
    if (!isRunning) return;
    try {
      const accountsRes = await supabase
        .from("exchange_accounts")
        .select("id, label, exchange, environment, api_key_enc, api_secret_enc")
        .eq("is_active", true)
        .eq("exchange", "bybit");

      if (accountsRes.error || !accountsRes.data) return;

      const accounts = accountsRes.data as unknown as Array<Pick<ExchangeAccountRow, "id" | "label" | "exchange" | "environment" | "api_key_enc" | "api_secret_enc">>;
      const activeAccountIds = new Set(accounts.map((a) => a.id));

      // Remove streams for deactivated accounts
      for (const [accId, unsub] of activeStreams.entries()) {
        if (!activeAccountIds.has(accId)) {
          logger.info({ accountId: accId }, "Stopping WebSocket stream for deactivated account");
          unsub();
          activeStreams.delete(accId);
        }
      }

      // Add streams for newly activated accounts
      for (const acc of accounts) {
        if (activeStreams.has(acc.id)) continue;
        if (!acc.api_key_enc || !acc.api_secret_enc) continue;

        try {
          const apiKey = decryptSecret(acc.api_key_enc, masterKey);
          const apiSecret = decryptSecret(acc.api_secret_enc, masterKey);
          const client = createBybitClient({
            apiKey,
            apiSecret,
            environment: acc.environment
          });

          logger.info({ account: acc.label, env: acc.environment }, "Subscribing to private Bybit WebSocket stream");
          const unsub = client.subscribeUserStream((event) => {
            void handleBybitUserEvent(supabase, client, { id: acc.id, label: acc.label }, event, discordWebhook);
          });

          activeStreams.set(acc.id, unsub);
        } catch (streamErr) {
          logger.error({ account: acc.label, err: streamErr }, "Failed to initialize WebSocket stream for account");
        }
      }
    } catch (err) {
      logger.error({ err }, "Error in WebSocket listener sync cycle");
    }
  }

  // Initial sync
  void syncStreams();

  // Sync every 30 seconds for any new accounts or credentials updates
  const interval = setInterval(() => {
    void syncStreams();
  }, 30_000);

  return () => {
    isRunning = false;
    clearInterval(interval);
    for (const [accId, unsub] of activeStreams.entries()) {
      try {
        unsub();
      } catch (e) {
        logger.warn({ accId, e }, "Error unsubscribing stream");
      }
    }
    activeStreams.clear();
    logger.info("Bybit WebSocket Listener Manager stopped.");
  };
}
