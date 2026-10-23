"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { accountConnectionSchema, createAccountClient } from "../../../../lib/account-client";
import { parseSignalText, createTradePreview, submitEntry, protectFilledPosition } from "@crypto-bot/trading";

export async function executeSignalAction(
  symbol: string,
  side: "long" | "short",
  margin: number,
  leverage: number
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rawAccount } = await supabase
    .from("exchange_accounts")
    .select("id, label, exchange, environment, api_key_enc, api_secret_enc, paper_balance")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!rawAccount) throw new Error("No active exchange account found");
  const account = accountConnectionSchema.parse(rawAccount);

  // Check risk settings
  const { data: rawSettings } = await supabase
    .from("risk_settings")
    .select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, allowed_symbols, kill_switch")
    .eq("account_id", account.id)
    .maybeSingle();

  if (rawSettings?.kill_switch) {
    throw new Error("Emergency Kill Switch is ACTIVE for this account");
  }

  const client = createAccountClient(account);
  const [ticker, instrument, balance] = await Promise.all([
    client.getTicker(symbol),
    client.getInstrument(symbol),
    client.getBalance()
  ]);

  const entryPrice = ticker.lastPrice;
  const slDist = entryPrice * 0.025;
  const slPrice = side === "long" ? entryPrice - slDist : entryPrice + slDist;
  const tp1Price = side === "long" ? entryPrice + slDist * 1.8 : entryPrice - slDist * 1.8;
  const tp2Price = side === "long" ? entryPrice + slDist * 2.6 : entryPrice - slDist * 2.6;
  const tp3Price = side === "long" ? entryPrice + slDist * 3.5 : entryPrice - slDist * 3.5;

  const rawSignalText = `${symbol} ${side.toUpperCase()}
entry ${entryPrice}
sl ${slPrice}
tp ${tp1Price} 40%, ${tp2Price} 30%, ${tp3Price} 30%
trail 1% after tp1
lev ${leverage}`;

  const parsedSignal = parseSignalText(rawSignalText, "chat");
  const preview = createTradePreview(
    parsedSignal,
    instrument,
    {
      riskPerTradePct: Number(rawSettings?.risk_per_trade_pct ?? 1),
      maxLeverage: Math.max(leverage, Number(rawSettings?.max_leverage ?? 5)),
      maxOpenPositions: Number(rawSettings?.max_open_positions ?? 3),
      maxDailyLossPct: Number(rawSettings?.max_daily_loss_pct ?? 5),
      killSwitch: false
    },
    {
      balance: balance.equity,
      marketPrice: entryPrice,
      openPositions: 0,
      dailyPnl: 0,
      customMargin: margin
    }
  );

  // Save signal
  const { data: storedSignal, error: sigErr } = await supabase.from("signals").insert({
    account_id: account.id,
    raw_text: rawSignalText,
    parsed: preview,
    source: "chat",
    status: "confirmed"
  }).select("id").maybeSingle();

  if (sigErr || !storedSignal) {
    throw new Error(sigErr?.message ?? "Failed to save signal");
  }

  // Create trade entry
  const { data: trade, error: tradeErr } = await supabase.from("trades").insert({
    account_id: account.id,
    signal_id: storedSignal.id,
    symbol: preview.signal.symbol,
    side: preview.signal.side,
    status: "entry_open",
    entry_avg: preview.entryPrice,
    qty: preview.qty,
    leverage: preview.leverage,
    sl: preview.signal.stopLoss,
    realized_pnl: 0
  }).select("id").single();

  const parsedTrade = z.object({ id: z.string() }).safeParse(trade);
  if (tradeErr || !parsedTrade.success) {
    throw new Error(tradeErr?.message ?? "Failed to create trade row");
  }

  const tradeId: string = parsedTrade.data.id;

  // Execute entry on exchange/paper
  const entrySubmission = await submitEntry(client, preview, tradeId);

  // Protect filled position
  if (entrySubmission.status === "entry_open") {
    await protectFilledPosition(client, preview, tradeId);
  }

  revalidatePath(`/dashboard/signal/${symbol}`);
  revalidatePath("/dashboard/positions");
  revalidatePath("/dashboard/chat");
}
