import { createBybitClient, createPaperExchangeClient, decryptSecret } from "@crypto-bot/exchange";
import type { ExchangeClient } from "@crypto-bot/shared";
import { z } from "zod";

export const accountConnectionSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  exchange: z.enum(["paper", "bybit", "binance"]),
  environment: z.enum(["live", "demo"]),
  api_key_enc: z.string().nullable(),
  api_secret_enc: z.string().nullable(),
  paper_balance: z.coerce.number().nullable()
});

export type AccountConnection = z.infer<typeof accountConnectionSchema>;

export function createAccountClient(account: AccountConnection): ExchangeClient {
  if (account.exchange === "paper") {
    return createPaperExchangeClient({ balance: account.paper_balance ?? 0 });
  }
  if (account.exchange !== "bybit") throw new Error(`${account.exchange} adapter is not implemented yet`);
  if (!account.api_key_enc || !account.api_secret_enc) throw new Error("Exchange credentials are missing");
  const masterKey = process.env.ENCRYPTION_MASTER_KEY;
  if (!masterKey) throw new Error("ENCRYPTION_MASTER_KEY is missing");
  return createBybitClient({
    environment: account.environment,
    apiKey: decryptSecret(account.api_key_enc, masterKey),
    apiSecret: decryptSecret(account.api_secret_enc, masterKey)
  });
}

