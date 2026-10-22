"use server";

import { createBybitClient, createPaperExchangeClient, decryptSecret, encryptSecret } from "@crypto-bot/exchange";
import { roundToStep } from "@crypto-bot/trading";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const accountSchema = z.object({
  label: z.string().trim().min(1).max(60),
  environment: z.enum(["live", "demo"]),
  apiKey: z.string().trim().min(8).max(200),
  apiSecret: z.string().trim().min(8).max(200)
});

function masterKey(): string {
  const value = process.env.ENCRYPTION_MASTER_KEY;
  if (!value) throw new Error("ENCRYPTION_MASTER_KEY is missing");
  return value;
}

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function authenticatedContext() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function connectBybitAccount(formData: FormData) {
  const parsed = accountSchema.safeParse({
    label: textField(formData, "label"),
    environment: textField(formData, "environment"),
    apiKey: textField(formData, "apiKey"),
    apiSecret: textField(formData, "apiSecret")
  });
  if (!parsed.success) redirect(`/dashboard/accounts?error=${encodeURIComponent("Invalid account details")}`);

  const { supabase, user } = await authenticatedContext();
  const client = createBybitClient(parsed.data);
  try {
    await client.getBalance();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bybit verification failed";
    redirect(`/dashboard/accounts?error=${encodeURIComponent(message)}`);
  }

  const { count } = await supabase
    .from("exchange_accounts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  const key = masterKey();
  const { data: account, error } = await supabase.from("exchange_accounts").insert({
    user_id: user.id,
    exchange: "bybit",
    environment: parsed.data.environment,
    label: parsed.data.label,
    api_key_enc: encryptSecret(parsed.data.apiKey, key),
    api_secret_enc: encryptSecret(parsed.data.apiSecret, key),
    is_active: count === 0
  }).select("id").single();
  if (error) redirect(`/dashboard/accounts?error=${encodeURIComponent(error.message)}`);

  const { error: riskError } = await supabase.from("risk_settings").insert({ account_id: account.id });
  if (riskError) redirect(`/dashboard/accounts?error=${encodeURIComponent(riskError.message)}`);
  revalidatePath("/dashboard");
  redirect("/dashboard/accounts?connected=1");
}

export async function activateAccount(formData: FormData) {
  const accountId = textField(formData, "accountId");
  const { supabase, user } = await authenticatedContext();
  const { error: clearError } = await supabase.from("exchange_accounts").update({ is_active: false }).eq("user_id", user.id);
  if (clearError) throw new Error(clearError.message);
  const { error } = await supabase.from("exchange_accounts").update({ is_active: true }).eq("id", accountId).eq("user_id", user.id);
  if (error) throw new Error(error.message);
  await supabase.from("audit_log").insert({ user_id: user.id, account_id: accountId, action: "account.activated" });
  revalidatePath("/dashboard");
}

export async function requestDemoFunds(formData: FormData) {
  const accountId = textField(formData, "accountId");
  const amount = Number(textField(formData, "amount"));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) throw new Error("Demo amount must be between 0 and 100000 USDT");
  const { supabase } = await authenticatedContext();
  const { data, error } = await supabase.from("exchange_accounts")
    .select("environment, api_key_enc, api_secret_enc")
    .eq("id", accountId)
    .single();
  if (error || !data) throw new Error("Account not found");
  const account = z.object({
    environment: z.string(),
    api_key_enc: z.string(),
    api_secret_enc: z.string()
  }).parse(data);
  if (account.environment !== "demo") throw new Error("Demo funding is unavailable for live accounts");
  const key = masterKey();
  const client = createBybitClient({
    environment: "demo",
    apiKey: decryptSecret(account.api_key_enc, key),
    apiSecret: decryptSecret(account.api_secret_enc, key)
  });
  await client.requestDemoFunds?.(amount);
  revalidatePath("/dashboard");
}

export async function ensurePaperAccount() {
  const { supabase, user } = await authenticatedContext();
  const { error } = await supabase.rpc("ensure_user_workspace", { target_user_id: user.id });
  if (error) redirect(`/dashboard/accounts?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/accounts?paper=1");
}

export async function topUpPaperBalance(formData: FormData) {
  const accountId = textField(formData, "accountId");
  const amount = Number(textField(formData, "amount"));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) throw new Error("Paper amount must be between 0 and 100000 USDT");
  const { supabase } = await authenticatedContext();
  const { error } = await supabase.rpc("top_up_paper_balance", { target_account_id: accountId, amount });
  if (error) redirect(`/dashboard/accounts?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/accounts?toppedUp=1");
}

export async function addPaperDepositAction(formData: FormData) {
  const accountId = textField(formData, "accountId");
  const amount = Number(textField(formData, "amount")) || 10000;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) throw new Error("Deposit amount must be between 0 and 100000 USDT");
  const { supabase } = await authenticatedContext();
  const { error } = await supabase.rpc("top_up_paper_balance", { target_account_id: accountId, amount });
  if (error) redirect(`/dashboard/profile?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/profile?depositAdded=1");
}

export async function updateProfile(formData: FormData) {
  const displayName = textField(formData, "displayName").trim();
  if (!displayName || displayName.length > 80) throw new Error("Display name must be between 1 and 80 characters");
  const { supabase, user } = await authenticatedContext();
  const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/profile?saved=1");
}

interface AccountInfo {
  id: string;
  user_id: string;
  exchange: string;
  environment: "live" | "demo";
  api_key_enc: string | null;
  api_secret_enc: string | null;
  paper_balance: number | null;
}

interface TradeWithAccount {
  id: string;
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry_avg: number | null;
  exchange_accounts: AccountInfo;
}

export async function closeTradePosition(formData: FormData) {
  const tradeId = textField(formData, "tradeId");
  const qtyPctStr = textField(formData, "qtyPct");
  const qtyPct = qtyPctStr === "50" ? 50 : 100;

  const { supabase, user } = await authenticatedContext();

  const tradeRes = await supabase
    .from("trades")
    .select("id, symbol, side, qty, entry_avg, exchange_accounts!inner(id, user_id, exchange, environment, api_key_enc, api_secret_enc, paper_balance)")
    .eq("id", tradeId)
    .eq("status", "active")
    .single();

  if (tradeRes.error || !tradeRes.data) throw new Error("Active trade not found");

  const trade = tradeRes.data as unknown as TradeWithAccount;
  const account = trade.exchange_accounts;

  if (account.user_id !== user.id) throw new Error("Unauthorized");

  const client = account.exchange === "paper"
    ? createPaperExchangeClient({ balance: account.paper_balance ?? 0 })
    : (() => {
        if (!account.api_key_enc || !account.api_secret_enc) throw new Error("Exchange credentials missing");
        return createBybitClient({
          apiKey: decryptSecret(account.api_key_enc, masterKey()),
          apiSecret: decryptSecret(account.api_secret_enc, masterKey()),
          environment: account.environment
        });
      })();

  const [instrument, ticker] = await Promise.all([
    client.getInstrument(trade.symbol),
    client.getTicker(trade.symbol)
  ]);

  const totalQty = Number(trade.qty);
  const closeQty = qtyPct === 50
    ? roundToStep(totalQty * 0.5, instrument.qtyStep, "down")
    : totalQty;

  if (closeQty <= 0) throw new Error("Calculated close quantity is too small");

  await client.closePosition(trade.symbol, closeQty);

  if (qtyPct === 100 || closeQty >= totalQty) {
    try {
      const openOrders = await client.getOpenOrders(trade.symbol);
      for (const o of openOrders) {
        await client.cancelOrder(trade.symbol, o.orderId);
      }
    } catch {
      // non-fatal if orders already cancelled
    }

    const pnl = (ticker.lastPrice - Number(trade.entry_avg)) * totalQty * (trade.side === "long" ? 1 : -1);

    await supabase.from("trades").update({
      status: "closed",
      closed_at: new Date().toISOString(),
      realized_pnl: pnl
    }).eq("id", trade.id);

    if (account.exchange === "paper") {
      const newBalance = Math.max(0, Number(account.paper_balance ?? 10000) + pnl);
      await supabase.from("exchange_accounts").update({ paper_balance: newBalance }).eq("id", account.id);
    }

    await supabase.from("trade_targets").update({ status: "cancelled" }).eq("trade_id", trade.id).eq("status", "open");

    await supabase.from("chat_messages").insert({
      account_id: account.id,
      role: "system",
      kind: "order_event",
      content: `Market closed position for ${trade.symbol} @ ${ticker.lastPrice}. Realized PnL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT.`,
      payload: { tradeId: trade.id, symbol: trade.symbol, pnl }
    });
  } else {
    const remainingQty = totalQty - closeQty;
    await supabase.from("trades").update({
      qty: remainingQty
    }).eq("id", trade.id);

    await supabase.from("chat_messages").insert({
      account_id: account.id,
      role: "system",
      kind: "order_event",
      content: `Closed 50% (${closeQty}) of position for ${trade.symbol} @ ${ticker.lastPrice}. Remaining size: ${remainingQty}.`,
      payload: { tradeId: trade.id, symbol: trade.symbol, closedQty: closeQty, remainingQty }
    });
  }

  revalidatePath("/dashboard/positions");
  revalidatePath("/dashboard/history");
  revalidatePath("/dashboard/chat");
  revalidatePath("/dashboard");
}

export async function closeAllPositions(formData: FormData) {
  const accountId = textField(formData, "accountId");
  const { supabase, user } = await authenticatedContext();

  const accountQuery = accountId
    ? supabase.from("exchange_accounts").select("id, exchange, environment, api_key_enc, api_secret_enc, paper_balance").eq("id", accountId).eq("user_id", user.id).single()
    : supabase.from("exchange_accounts").select("id, exchange, environment, api_key_enc, api_secret_enc, paper_balance").eq("user_id", user.id).eq("is_active", true).single();

  const accRes = await accountQuery;
  if (accRes.error || !accRes.data) throw new Error("Active account not found");
  const account = accRes.data as unknown as AccountInfo;

  const tradesRes = await supabase
    .from("trades")
    .select("id, symbol, side, qty, entry_avg")
    .eq("account_id", account.id)
    .eq("status", "active");

  const activeTrades = (tradesRes.data ?? []) as unknown as Array<{
    id: string;
    symbol: string;
    side: "long" | "short";
    qty: number;
    entry_avg: number | null;
  }>;

  if (activeTrades.length === 0) return;

  const client = account.exchange === "paper"
    ? createPaperExchangeClient({ balance: account.paper_balance ?? 0 })
    : (() => {
        if (!account.api_key_enc || !account.api_secret_enc) throw new Error("Exchange credentials missing");
        return createBybitClient({
          apiKey: decryptSecret(account.api_key_enc, masterKey()),
          apiSecret: decryptSecret(account.api_secret_enc, masterKey()),
          environment: account.environment
        });
      })();

  for (const trade of activeTrades) {
    try {
      const ticker = await client.getTicker(trade.symbol);
      await client.closePosition(trade.symbol, Number(trade.qty));

      try {
        const openOrders = await client.getOpenOrders(trade.symbol);
        for (const o of openOrders) {
          await client.cancelOrder(trade.symbol, o.orderId);
        }
      } catch {
        // ignore
      }

      const pnl = (ticker.lastPrice - Number(trade.entry_avg)) * Number(trade.qty) * (trade.side === "long" ? 1 : -1);

      await supabase.from("trades").update({
        status: "closed",
        closed_at: new Date().toISOString(),
        realized_pnl: pnl
      }).eq("id", trade.id);

      if (account.exchange === "paper") {
        const newBalance = Math.max(0, Number(account.paper_balance ?? 10000) + pnl);
        await supabase.from("exchange_accounts").update({ paper_balance: newBalance }).eq("id", account.id);
      }

      await supabase.from("trade_targets").update({ status: "cancelled" }).eq("trade_id", trade.id).eq("status", "open");

      await supabase.from("chat_messages").insert({
        account_id: account.id,
        role: "system",
        kind: "order_event",
        content: `Closed position for ${trade.symbol} via Close All. Realized PnL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT.`,
        payload: { tradeId: trade.id, symbol: trade.symbol, pnl }
      });
    } catch {
      // Continue closing others
    }
  }

  revalidatePath("/dashboard/positions");
  revalidatePath("/dashboard/history");
  revalidatePath("/dashboard/chat");
  revalidatePath("/dashboard");
}



