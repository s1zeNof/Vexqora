import { createBybitClient, decryptSecret } from "@crypto-bot/exchange";
import type { ExchangeAccountRow, Position, TradeRow } from "@crypto-bot/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";

export async function reconcileOnStartup(supabase: SupabaseClient, masterKey: string): Promise<void> {
  logger.info("Starting worker startup reconciliation with Bybit exchange...");

  const { data: rawAccounts, error: accountsError } = await supabase
    .from("exchange_accounts")
    .select("id, label, environment, api_key_enc, api_secret_enc")
    .eq("is_active", true);

  if (accountsError || !rawAccounts) {
    logger.warn({ error: accountsError }, "Could not fetch active exchange accounts for reconciliation");
    return;
  }

  const accounts = rawAccounts as Array<Pick<ExchangeAccountRow, "id" | "label" | "environment" | "api_key_enc" | "api_secret_enc">>;

  for (const account of accounts) {
    try {
      const apiKey = decryptSecret(account.api_key_enc, masterKey);
      const apiSecret = decryptSecret(account.api_secret_enc, masterKey);
      const client = createBybitClient({
        apiKey,
        apiSecret,
        environment: account.environment
      });

      const [positions, openTradesRes] = await Promise.all([
        client.getPositions(),
        supabase.from("trades").select("*").eq("account_id", account.id).in("status", ["entry_open", "active"])
      ]);

      const dbTrades = (openTradesRes.data ?? []) as TradeRow[];

      logger.info({
        account: account.label,
        bybitPositions: positions.length,
        dbOpenTrades: dbTrades.length
      }, "Reconciliation snapshot fetched");

      for (const trade of dbTrades) {
        const livePos = positions.find((p: Position) => p.symbol.toUpperCase() === trade.symbol.toUpperCase() && p.qty > 0);

        if (trade.status === "entry_open" && livePos) {
          logger.warn({ tradeId: trade.id, symbol: trade.symbol }, "Trade filled during offline period. Transitioning to active and verifying protective stops.");
          await supabase.from("trades").update({
            status: "active",
            entry_avg: livePos.entryPrice,
            opened_at: new Date().toISOString()
          }).eq("id", trade.id);

          // Ensure protective stop loss is set on exchange
          if (trade.sl) {
            await client.setTradingStop({
              symbol: trade.symbol,
              stopLoss: Number(trade.sl)
            });
            logger.info({ symbol: trade.symbol, sl: trade.sl }, "Protective stop-loss verified on exchange during reconciliation");
          }
        } else if (trade.status === "active" && !livePos) {
          logger.info({ tradeId: trade.id, symbol: trade.symbol }, "Position closed on exchange while offline. Updating database state.");
          await supabase.from("trades").update({
            status: "closed",
            closed_at: new Date().toISOString()
          }).eq("id", trade.id);

          await supabase.from("chat_messages").insert({
            account_id: account.id,
            role: "system",
            kind: "order_event",
            content: `Trade ${trade.symbol} closed on Bybit. State reconciled after worker restart.`,
            payload: { tradeId: trade.id, symbol: trade.symbol }
          });
        }
      }
    } catch (err) {
      logger.error({ account: account.label, err }, "Error during account reconciliation");
    }
  }

  logger.info("Startup reconciliation complete.");
}
