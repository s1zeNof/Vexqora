"use server";

import {
  createTradePreview,
  enhanceNemotronSignal,
  generateNemotronOpportunity,
  parseSignalText,
  type TradePreview
} from "@crypto-bot/trading";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { accountConnectionSchema, createAccountClient } from "../../../lib/account-client";
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

const riskRow = z.object({
  risk_per_trade_pct: z.coerce.number(),
  max_leverage: z.coerce.number(),
  max_open_positions: z.coerce.number(),
  max_daily_loss_pct: z.coerce.number(),
  allowed_symbols: z.array(z.string()).nullable(),
  kill_switch: z.boolean()
});

export async function scanMarketOpportunityAction(formData: FormData): Promise<void> {
  const symbol = (textField(formData, "symbol") || "BTCUSDT").toUpperCase();
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rawAccount, error: accountError } = await supabase.from("exchange_accounts")
    .select("id, label, exchange, environment, api_key_enc, api_secret_enc, paper_balance")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();
  if (accountError || !rawAccount) redirect("/dashboard/accounts");
  const account = accountConnectionSchema.parse(rawAccount);

  const { data: rawSettings, error: settingsError } = await supabase.from("risk_settings")
    .select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, allowed_symbols, kill_switch")
    .eq("account_id", account.id)
    .single();
  if (settingsError || !rawSettings) redirect("/dashboard/risk");
  const settings = riskRow.parse(rawSettings);

  const client = createAccountClient(account);
  const [balance, instrument, ticker] = await Promise.all([
    client.getBalance(),
    client.getInstrument(symbol),
    client.getTicker(symbol)
  ]);

  // Powered by Nvidia Nemotron 3 Ultra 550B via OpenRouter
  const opp = await generateNemotronOpportunity(symbol, ticker.lastPrice, {
    tickSize: instrument.tickSize,
    leverage: Number(settings.max_leverage) > 5 ? 5 : Number(settings.max_leverage),
    riskPct: Number(settings.risk_per_trade_pct)
  });

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

  const preview = createTradePreview(opp.parsedSignal, instrument, {
    riskPerTradePct: settings.risk_per_trade_pct,
    maxLeverage: settings.max_leverage,
    maxOpenPositions: settings.max_open_positions,
    maxDailyLossPct: settings.max_daily_loss_pct,
    ...(settings.allowed_symbols ? { allowedSymbols: settings.allowed_symbols } : {}),
    killSwitch: settings.kill_switch
  }, { balance: balance.equity, marketPrice: ticker.lastPrice, openPositions: openPositions ?? 0, dailyPnl });

  const { data: stored, error: insertError } = await supabase.from("signals").insert({
    account_id: account.id,
    raw_text: opp.rawSignal,
    parsed: preview,
    source: "chat",
    status: "preview"
  }).select("id").single();

  if (insertError || !stored) {
    redirect(`/dashboard/chat?error=${encodeURIComponent(insertError?.message ?? "Failed to save signal")}`);
  }

  const storedSignal = z.object({ id: z.string().uuid() }).parse(stored);

  await supabase.from("chat_messages").insert({
    account_id: account.id,
    role: "assistant",
    kind: "ai_signal",
    content: `Nemotron 3 Ultra: ${opp.symbol} ${opp.side.toUpperCase()} (${opp.strategy})`,
    payload: {
      opportunity: opp,
      preview,
      signalId: storedSignal.id,
      rawSignal: opp.rawSignal
    }
  });

  revalidatePath("/dashboard/chat");
  redirect("/dashboard/chat");
}

export async function enhanceSignalAction(formData: FormData): Promise<void> {
  const rawSignal = textField(formData, "rawSignal");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rawAccount } = await supabase.from("exchange_accounts")
    .select("id, label, exchange, environment, api_key_enc, api_secret_enc, paper_balance")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();
  if (!rawAccount) redirect("/dashboard/accounts");
  const account = accountConnectionSchema.parse(rawAccount);

  const client = createAccountClient(account);
  const parsed = parseSignalText(rawSignal, "chat");
  const [balance, instrument, ticker] = await Promise.all([
    client.getBalance(),
    client.getInstrument(parsed.symbol),
    client.getTicker(parsed.symbol)
  ]);

  // Powered by Nvidia Nemotron 3 Ultra 550B
  const enhanced = await enhanceNemotronSignal(rawSignal, ticker.lastPrice, instrument.tickSize);

  const { data: rawSettings } = await supabase.from("risk_settings")
    .select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, allowed_symbols, kill_switch")
    .eq("account_id", account.id)
    .single();
  const settings = riskRow.parse(rawSettings);

  const preview = createTradePreview(enhanced.parsedSignal, instrument, {
    riskPerTradePct: settings.risk_per_trade_pct,
    maxLeverage: settings.max_leverage,
    maxOpenPositions: settings.max_open_positions,
    maxDailyLossPct: settings.max_daily_loss_pct,
    ...(settings.allowed_symbols ? { allowedSymbols: settings.allowed_symbols } : {}),
    killSwitch: settings.kill_switch
  }, { balance: balance.equity, marketPrice: ticker.lastPrice, openPositions: 0, dailyPnl: 0 });

  const { data: stored } = await supabase.from("signals").insert({
    account_id: account.id,
    raw_text: enhanced.rawText,
    parsed: preview,
    source: "chat",
    status: "preview"
  }).select("id").single();

  const storedSignal = z.object({ id: z.string().uuid() }).parse(stored);

  await supabase.from("chat_messages").insert({
    account_id: account.id,
    role: "assistant",
    kind: "ai_signal",
    content: `✨ ${enhanced.summary}`,
    payload: {
      improvements: enhanced.improvements,
      preview,
      signalId: storedSignal.id,
      rawSignal: enhanced.rawText
    }
  });

  revalidatePath("/dashboard/chat");
  redirect("/dashboard/chat");
}

export async function previewSignal(_previous: PreviewState, formData: FormData): Promise<PreviewState> {
  try {
    const rawText = textField(formData, "signal").trim();
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Authentication required" };

    const { data: rawAccount, error: accountError } = await supabase.from("exchange_accounts")
      .select("id, label, exchange, environment, api_key_enc, api_secret_enc, paper_balance")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();
    if (accountError || !rawAccount) return { error: "Your trading workspace is not ready yet. Open Accounts and create a paper account." };
    const account = accountConnectionSchema.parse(rawAccount);

    const client = createAccountClient(account);

    // If user asked to scan or typed just a coin ticker (e.g., "SOL", "BTC", "ETH", "scan SOL")
    const words = rawText.toUpperCase().split(/\s+/);
    const isScanRequest = rawText.toLowerCase().includes("scan") || (!rawText.includes("LONG") && !rawText.includes("SHORT"));
    if (isScanRequest) {
      let targetSymbol = words.find(w => w.endsWith("USDT") || ["BTC", "ETH", "SOL", "BNB", "DOGE", "XRP"].includes(w)) ?? "BTCUSDT";
      if (!targetSymbol.endsWith("USDT")) targetSymbol = `${targetSymbol}USDT`;

      const [ticker, instrument] = await Promise.all([
        client.getTicker(targetSymbol),
        client.getInstrument(targetSymbol)
      ]);

      // Use Nvidia Nemotron 3 Ultra
      const opp = await generateNemotronOpportunity(targetSymbol, ticker.lastPrice, { tickSize: instrument.tickSize });

      const { data: rawSettings } = await supabase.from("risk_settings")
        .select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, allowed_symbols, kill_switch")
        .eq("account_id", account.id)
        .single();
      const settings = riskRow.parse(rawSettings);

      const balance = await client.getBalance();
      const preview = createTradePreview(opp.parsedSignal, instrument, {
        riskPerTradePct: settings.risk_per_trade_pct,
        maxLeverage: settings.max_leverage,
        maxOpenPositions: settings.max_open_positions,
        maxDailyLossPct: settings.max_daily_loss_pct,
        ...(settings.allowed_symbols ? { allowedSymbols: settings.allowed_symbols } : {}),
        killSwitch: settings.kill_switch
      }, { balance: balance.equity, marketPrice: ticker.lastPrice, openPositions: 0, dailyPnl: 0 });

      const { data: stored } = await supabase.from("signals").insert({
        account_id: account.id,
        raw_text: opp.rawSignal,
        parsed: preview,
        source: "chat",
        status: "preview"
      }).select("id").single();
      const storedSignal = z.object({ id: z.string().uuid() }).parse(stored);

      await supabase.from("chat_messages").insert([
        { account_id: account.id, role: "user", kind: "user_signal", content: rawText },
        {
          account_id: account.id,
          role: "assistant",
          kind: "ai_signal",
          content: `Nemotron 3 Ultra: ${opp.symbol} ${opp.side.toUpperCase()} (${opp.strategy})`,
          payload: {
            opportunity: opp,
            preview,
            signalId: storedSignal.id,
            rawSignal: opp.rawSignal
          }
        }
      ]);

      revalidatePath("/dashboard/chat");
      return { signalId: storedSignal.id, preview };
    }

    const signal = parseSignalText(rawText, "chat");

    const { data: rawSettings, error: settingsError } = await supabase.from("risk_settings")
      .select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, allowed_symbols, kill_switch")
      .eq("account_id", account.id)
      .single();
    if (settingsError || !rawSettings) return { error: "Risk settings are missing" };
    const settings = riskRow.parse(rawSettings);

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
