"use server";

import { createBybitClient, decryptSecret } from "@crypto-bot/exchange";
import { createTradePreview, parseSignalText, type TradePreview } from "@crypto-bot/trading";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export interface PreviewState {
  error?: string;
  signalId?: string;
  preview?: TradePreview;
}

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function masterKey(): string {
  const value = process.env.ENCRYPTION_MASTER_KEY;
  if (!value) throw new Error("ENCRYPTION_MASTER_KEY is missing");
  return value;
}

const accountRow = z.object({
  id: z.string().uuid(),
  environment: z.enum(["live", "demo"]),
  api_key_enc: z.string(),
  api_secret_enc: z.string()
});

const riskRow = z.object({
  risk_per_trade_pct: z.coerce.number(),
  max_leverage: z.coerce.number(),
  max_open_positions: z.coerce.number(),
  max_daily_loss_pct: z.coerce.number(),
  allowed_symbols: z.array(z.string()).nullable(),
  kill_switch: z.boolean()
});

export async function previewSignal(_previous: PreviewState, formData: FormData): Promise<PreviewState> {
  try {
    const rawText = textField(formData, "signal");
    const signal = parseSignalText(rawText, "chat");
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Authentication required" };

    const { data: rawAccount, error: accountError } = await supabase.from("exchange_accounts")
      .select("id, environment, api_key_enc, api_secret_enc")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();
    if (accountError || !rawAccount) return { error: "Connect and activate a Bybit account first" };
    const account = accountRow.parse(rawAccount);

    const { data: rawSettings, error: settingsError } = await supabase.from("risk_settings")
      .select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, allowed_symbols, kill_switch")
      .eq("account_id", account.id)
      .single();
    if (settingsError || !rawSettings) return { error: "Risk settings are missing" };
    const settings = riskRow.parse(rawSettings);

    const key = masterKey();
    const client = createBybitClient({
      environment: account.environment,
      apiKey: decryptSecret(account.api_key_enc, key),
      apiSecret: decryptSecret(account.api_secret_enc, key)
    });
    const [balance, instrument, ticker] = await Promise.all([
      client.getBalance(), client.getInstrument(signal.symbol), client.getTicker(signal.symbol)
    ]);
    const { count: openPositions } = await supabase.from("trades")
      .select("id", { count: "exact", head: true })
      .eq("account_id", account.id)
      .in("status", ["entry_open", "active"]);
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const { data: pnlRows } = await supabase.from("trades")
      .select("realized_pnl")
      .eq("account_id", account.id)
      .gte("closed_at", dayStart.toISOString());
    const dailyPnl = (pnlRows ?? []).reduce((sum: number, row: { realized_pnl: unknown }) => sum + Number(row.realized_pnl ?? 0), 0);
    const preview = createTradePreview(signal, instrument, {
      riskPerTradePct: settings.risk_per_trade_pct,
      maxLeverage: settings.max_leverage,
      maxOpenPositions: settings.max_open_positions,
      maxDailyLossPct: settings.max_daily_loss_pct,
      ...(settings.allowed_symbols ? { allowedSymbols: settings.allowed_symbols } : {}),
      killSwitch: settings.kill_switch
    }, { balance: balance.equity, marketPrice: ticker.lastPrice, openPositions: openPositions ?? 0, dailyPnl });

    const { data: stored, error: insertError } = await supabase.from("signals").insert({
      account_id: account.id,
      raw_text: rawText,
      parsed: preview,
      source: "chat",
      status: "preview"
    }).select("id").single();
    if (insertError || !stored) return { error: insertError?.message ?? "Failed to save signal preview" };
    const storedSignal = z.object({ id: z.string().uuid() }).parse(stored);
    await supabase.from("chat_messages").insert([
      { account_id: account.id, role: "user", kind: "user_signal", content: rawText, payload: { signalId: storedSignal.id } },
      { account_id: account.id, role: "system", kind: "signal_preview", content: `Preview ready for ${signal.symbol}`, payload: { signalId: storedSignal.id, preview } }
    ]);
    revalidatePath("/dashboard/chat");
    return { signalId: storedSignal.id, preview };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to preview signal" };
  }
}

export async function confirmSignal(formData: FormData) {
  const signalId = textField(formData, "signalId");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase.rpc("confirm_signal", { target_signal_id: signalId });
  if (error) redirect(`/dashboard/chat?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/dashboard/chat");
  redirect("/dashboard/chat?queued=1");
}

export async function cancelSignal(formData: FormData) {
  const signalId = textField(formData, "signalId");
  const supabase = await createSupabaseServerClient();
  const { data: signal } = await supabase.from("signals").update({ status: "cancelled" })
    .eq("id", signalId).eq("status", "preview").select("account_id").single();
  if (signal) {
    const row = z.object({ account_id: z.string().uuid() }).parse(signal);
    await supabase.from("chat_messages").insert({
      account_id: row.account_id, role: "system", kind: "system", content: "Signal cancelled", payload: { signalId }
    });
  }
  revalidatePath("/dashboard/chat");
  redirect("/dashboard/chat");
}

