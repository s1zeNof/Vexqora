"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { accountConnectionSchema, createAccountClient } from "../../../../lib/account-client";
import { sanitizeSymbol } from "@crypto-bot/shared";
import { parseSignalText, createTradePreview, submitEntry, protectFilledPosition } from "@crypto-bot/trading";

export async function executeSignalAction(
  symbol: string,
  side: "long" | "short",
  margin: number,
  leverage: number,
  existingSignalId?: string | null
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

  let canonicalRawText: string | null = null;
  if (existingSignalId) {
    const { data: storedSignal, error: storedSignalError } = await supabase
      .from("signals")
      .select("raw_text")
      .eq("id", existingSignalId)
      .eq("account_id", account.id)
      .maybeSingle();
    const rawText = (storedSignal as { raw_text?: string | null } | null)?.raw_text;
    if (storedSignalError || !rawText) {
      throw new Error("Canonical signal snapshot is unavailable");
    }
    canonicalRawText = rawText;
  }

  // Check risk settings
  const { data: rawSettings } = await supabase
    .from("risk_settings")
    .select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, allowed_symbols, kill_switch")
    .eq("account_id", account.id)
    .maybeSingle();

  if (rawSettings?.kill_switch) {
    throw new Error("Emergency Kill Switch is ACTIVE for this account");
  }

  const canonicalSignal = canonicalRawText ? parseSignalText(canonicalRawText, "api") : null;
  const executionSymbol = sanitizeSymbol(canonicalSignal?.symbol ?? symbol);
  const executionSide = canonicalSignal?.side ?? side;
  const client = createAccountClient(account);
  const [ticker, instrument, balance] = await Promise.all([
    client.getTicker(executionSymbol),
    client.getInstrument(executionSymbol),
    client.getBalance()
  ]);

  const entryPrice = ticker.lastPrice;
  const slDist = entryPrice * 0.025;
  const slPrice = executionSide === "long" ? entryPrice - slDist : entryPrice + slDist;
  const tp1Price = executionSide === "long" ? entryPrice + slDist * 1.8 : entryPrice - slDist * 1.8;
  const tp2Price = executionSide === "long" ? entryPrice + slDist * 2.6 : entryPrice - slDist * 2.6;
  const tp3Price = executionSide === "long" ? entryPrice + slDist * 3.5 : entryPrice - slDist * 3.5;

  const rawSignalText = canonicalRawText ?? `${executionSymbol} ${executionSide.toUpperCase()}
entry ${entryPrice}
sl ${slPrice}
tp ${tp1Price} 40%, ${tp2Price} 30%, ${tp3Price} 30%
trail 1% after tp1
lev ${leverage}`;

  const parsedSignal = { ...parseSignalText(rawSignalText, "api"), leverage };
  const preview = createTradePreview(
    parsedSignal,
    instrument,
    {
      riskPerTradePct: Number(rawSettings?.risk_per_trade_pct ?? 1),
      maxLeverage: Number(rawSettings?.max_leverage ?? 5),
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

  let targetSignalId = existingSignalId;

  if (!targetSignalId) {
    // Save new signal row
    const { data: storedSignal, error: sigErr } = await supabase.from("signals").insert({
      account_id: account.id,
      raw_text: rawSignalText,
      parsed: preview,
      source: "chat",
      status: "confirmed"
    }).select("id").maybeSingle();

    const parsedStored = z.object({ id: z.string() }).safeParse(storedSignal);
    if (sigErr || !parsedStored.success) {
      throw new Error(sigErr?.message ?? "Failed to save signal");
    }
    targetSignalId = parsedStored.data.id;
  } else {
    // Update existing signal status
    await supabase.from("signals").update({ status: "confirmed" }).eq("id", targetSignalId);
  }

  // Create trade entry with active status and opened_at timestamp
  const nowIso = new Date().toISOString();
  const { data: trade, error: tradeErr } = await supabase.from("trades").insert({
    account_id: account.id,
    signal_id: targetSignalId,
    symbol: preview.signal.symbol,
    side: preview.signal.side,
    status: "active",
    entry_avg: preview.entryPrice,
    qty: preview.qty,
    leverage: preview.leverage,
    sl: preview.signal.stopLoss,
    trailing_stop: preview.signal.trailingStop ?? null,
    realized_pnl: 0,
    opened_at: nowIso
  }).select("id").single();

  const parsedTrade = z.object({ id: z.string() }).safeParse(trade);
  if (tradeErr || !parsedTrade.success) {
    throw new Error(tradeErr?.message ?? "Failed to create trade row");
  }

  const tradeId: string = parsedTrade.data.id;

  // Execute entry on exchange/paper
  const entrySubmission = await submitEntry(client, preview, tradeId);

  // Persist entry order
  await supabase.from("orders").insert({
    trade_id: tradeId,
    exchange_order_id: entrySubmission.entryOrder.orderId,
    order_link_id: entrySubmission.entryOrder.orderLinkId ?? `entry-${tradeId}`,
    type: preview.signal.entry.type === "market" ? "market" : "limit",
    side: preview.signal.side === "long" ? "buy" : "sell",
    price: preview.entryPrice,
    qty: preview.qty,
    status: "filled",
    reduce_only: false,
    raw: { preview: JSON.parse(JSON.stringify(preview)) as Record<string, unknown>, exchange: account.exchange }
  });

  // Protect filled position with SL and TP
  const protection = await protectFilledPosition(client, preview, tradeId);
  for (const [idx, tpOrder] of protection.takeProfitOrders.entries()) {
    const target = preview.signal.takeProfits[idx];
    if (target) {
      await supabase.from("trade_targets").insert({
        trade_id: tradeId,
        idx: idx + 1,
        price: target.price,
        share_pct: target.sharePct,
        status: "open",
        order_id: tpOrder.orderId
      });
    }
  }

  revalidatePath(`/dashboard/signal/${symbol}`);
  if (targetSignalId) {
    revalidatePath(`/dashboard/signal/${targetSignalId}`);
  }
  revalidatePath("/dashboard/signals");
  revalidatePath("/dashboard/positions");
  revalidatePath("/dashboard/history");
  revalidatePath("/dashboard/chat");
  revalidatePath("/dashboard");
}

export async function deleteSignalAction(signalId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("signals").delete().eq("id", signalId);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/dashboard/signals");
  revalidatePath("/dashboard/chat");
}

export async function toggleTradeControlMode(
  tradeId: string,
  mode: "auto" | "manual",
  currentPath?: string
): Promise<{ success: boolean; mode: "auto" | "manual" }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: trade, error: tradeErr } = await supabase
    .from("trades")
    .select("id, account_id, symbol, trailing_stop, exchange_accounts!inner(user_id)")
    .eq("id", tradeId)
    .maybeSingle();

  if (tradeErr || !trade) {
    throw new Error("Trade not found or unauthorized");
  }

  const currentTs = (trade.trailing_stop as Record<string, unknown> | null) ?? {};
  const updatedTs = { ...currentTs, controlMode: mode };

  await supabase.from("trades").update({
    trailing_stop: updatedTs
  }).eq("id", tradeId);

  await supabase.from("chat_messages").insert({
    account_id: trade.account_id,
    role: "system",
    kind: "user_action",
    content: mode === "manual"
      ? `👤 Перемкнуто на «Ручний контроль» для ${trade.symbol}. Автоматичне спрацювання TP/SL/Trailing призупинено.`
      : `🤖 Перемкнуто на «Автопілот» для ${trade.symbol}. Автоматичне виконання TP, SL та Trailing Stop відновлено.`,
    payload: { tradeId, mode }
  });

  if (currentPath) {
    revalidatePath(currentPath);
  }
  revalidatePath(`/dashboard/signal/${trade.symbol}`);
  revalidatePath("/dashboard/positions");
  revalidatePath("/dashboard/signals");

  return { success: true, mode };
}
