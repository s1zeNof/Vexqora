"use server";

import { createBybitClient, createPaperExchangeClient, decryptSecret, fetchRecentKlines } from "@crypto-bot/exchange";
import { formatCryptoPrice, type Signal } from "@crypto-bot/shared";
import {
  createTradePreview,
  enhanceNemotronSignal,
  fetchTopUniverseOpportunities,
  findHistoricalPatternMatch,
  generateNemotronOpportunity,
  parseSignalText,
  protectFilledPosition,
  submitEntry,
  type TradePreview,
  type UniverseScanFilter
} from "@crypto-bot/trading";
import { isRedirectError } from "next/dist/client/components/redirect-error";
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
  try {
    const rawSymbol = (textField(formData, "symbol") || "UNIVERSE").toUpperCase().trim();
    const rawFilter = (textField(formData, "filter") || textField(formData, "mode") || "balanced").toLowerCase();
    const scanFilter: UniverseScanFilter =
      rawFilter === "moderate" || rawFilter === "помірні" || rawFilter === "steady"
        ? "moderate"
        : rawFilter === "momentum"
          ? "momentum"
          : rawFilter === "volatile"
            ? "volatile"
            : "balanced";

    let symbolsToScan: string[] = [];

    if (rawSymbol === "ALL" || rawSymbol === "UNIVERSE" || rawSymbol === "ВСЕ" || rawSymbol === "РИНОК" || rawSymbol === "MODERATE" || rawSymbol === "ПОМІРНІ") {
      const effectiveFilter = (rawSymbol === "MODERATE" || rawSymbol === "ПОМІРНІ") ? "moderate" : scanFilter;
      const topOpps = await fetchTopUniverseOpportunities(3, fetch, effectiveFilter);
      symbolsToScan = topOpps.map(o => o.symbol);
    } else {
      let clean = rawSymbol.replace(/[^A-Z0-9]/g, "");
      if (!clean.endsWith("USDT")) clean = `${clean}USDT`;
      symbolsToScan = [clean];
    }
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const { data: rawAccount, error: accountError } = await supabase.from("exchange_accounts")
      .select("id, label, exchange, environment, api_key_enc, api_secret_enc, paper_balance")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (accountError || !rawAccount) redirect("/dashboard/accounts");
    const account = accountConnectionSchema.parse(rawAccount);

    const { data: rawSettings } = await supabase.from("risk_settings")
      .select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, allowed_symbols, kill_switch")
      .eq("account_id", account.id)
      .limit(1)
      .maybeSingle();
    const settings = rawSettings ? riskRow.parse(rawSettings) : {
      risk_per_trade_pct: 1,
      max_leverage: 5,
      max_open_positions: 3,
      max_daily_loss_pct: 5,
      allowed_symbols: null,
      kill_switch: false
    };

    const client = createAccountClient(account);
    const balance = await client.getBalance();

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

    for (const symbol of symbolsToScan) {
      try {
        const [instrument, ticker, klines] = await Promise.all([
          client.getInstrument(symbol),
          client.getTicker(symbol),
          fetchRecentKlines(symbol, "15", 15).catch(() => [])
        ]);

        const hist = findHistoricalPatternMatch(symbol, "liquidity_sweep", 2.5, klines);
        const opp = await generateNemotronOpportunity(symbol, ticker.lastPrice, {
          tickSize: instrument.tickSize,
          leverage: Number(settings.max_leverage) > 5 ? 5 : Number(settings.max_leverage),
          riskPct: Number(settings.risk_per_trade_pct),
          historicalContext: hist,
          klines
        });

        if (opp.side === "no_trade" || opp.decision === "NO_TRADE") {
          await supabase.from("chat_messages").insert({
            account_id: account.id,
            role: "assistant",
            kind: "system_alert",
            content: `🛡️ Nemotron AI: Вхід по ${opp.symbol} відхилено (NO_TRADE). ${opp.rationale}`,
            payload: {
              opportunity: opp,
              historicalMatch: hist
            }
          });
          continue;
        }

        const preview = createTradePreview(opp.parsedSignal, instrument, {
          riskPerTradePct: settings.risk_per_trade_pct,
          maxLeverage: settings.max_leverage,
          maxOpenPositions: settings.max_open_positions,
          maxDailyLossPct: settings.max_daily_loss_pct,
          ...(settings.allowed_symbols ? { allowedSymbols: settings.allowed_symbols } : {}),
          killSwitch: settings.kill_switch
        }, { balance: balance.equity, marketPrice: ticker.lastPrice, openPositions: openPositions ?? 0, dailyPnl });

        const fullParsed = {
          ...preview,
          signal: preview.signal,
          opportunity: opp
        };

        const { data: stored } = await supabase.from("signals").insert({
          account_id: account.id,
          raw_text: opp.rawSignal,
          parsed: fullParsed,
          source: "chat",
          status: "preview"
        }).select("id").limit(1).maybeSingle();

        if (stored) {
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
              rawSignal: opp.rawSignal,
              historicalMatch: hist
            }
          });
        }
      } catch (scanErr) {
        console.warn(`Scan error for ${symbol}:`, scanErr);
      }
    }

    revalidatePath("/dashboard/signals");
    revalidatePath("/dashboard/signals?tab=active");
    revalidatePath("/dashboard/chat");
    const redirectTo = textField(formData, "redirectTo");
    if (redirectTo) {
      redirect(redirectTo);
    } else {
      redirect("/dashboard/chat?tab=signals");
    }
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const message = error instanceof Error ? error.message : "Failed to scan market opportunity";
    redirect(`/dashboard/chat?error=${encodeURIComponent(message)}`);
  }
}

export async function analyzePulseAction(formData: FormData): Promise<void> {
  try {
    const symbol = (textField(formData, "symbol") || "BTCUSDT").toUpperCase();
    const rawAnomalyType = textField(formData, "eventType") || "liquidity_sweep";
    const changePct = Number(textField(formData, "changePct") || "2.5");
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const { data: rawAccount } = await supabase.from("exchange_accounts")
      .select("id, label, exchange, environment, api_key_enc, api_secret_enc, paper_balance")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!rawAccount) redirect("/dashboard/accounts");
    const account = accountConnectionSchema.parse(rawAccount);

    const client = createAccountClient(account);
    const [ticker, instrument, klines] = await Promise.all([
      client.getTicker(symbol),
      client.getInstrument(symbol),
      fetchRecentKlines(symbol, "15", 15).catch(() => [])
    ]);

    const { data: rawSettings } = await supabase.from("risk_settings")
      .select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, allowed_symbols, kill_switch")
      .eq("account_id", account.id)
      .limit(1)
      .maybeSingle();
    const settings = rawSettings ? riskRow.parse(rawSettings) : {
      risk_per_trade_pct: 1,
      max_leverage: 5,
      max_open_positions: 3,
      max_daily_loss_pct: 5,
      allowed_symbols: null,
      kill_switch: false
    };

    const hist = findHistoricalPatternMatch(symbol, rawAnomalyType, changePct, klines);
    const opp = await generateNemotronOpportunity(symbol, ticker.lastPrice, {
      tickSize: instrument.tickSize,
      leverage: Math.min(Number(settings.max_leverage || 5), 5),
      riskPct: Number(settings.risk_per_trade_pct || 1),
      historicalContext: hist,
      klines
    });

    if (opp.side === "no_trade" || opp.decision === "NO_TRADE") {
      await supabase.from("chat_messages").insert({
        account_id: account.id,
        role: "assistant",
        kind: "system_alert",
        content: `🛡️ Nemotron AI: Вхід по ${opp.symbol} відхилено (NO_TRADE). ${opp.rationale}`,
        payload: {
          opportunity: opp,
          historicalMatch: hist
        }
      });
      revalidatePath("/dashboard/chat");
      redirect("/dashboard/chat?tab=feed");
    }

    const balance = await client.getBalance();
    const preview = createTradePreview(opp.parsedSignal, instrument, {
      riskPerTradePct: settings.risk_per_trade_pct,
      maxLeverage: settings.max_leverage,
      maxOpenPositions: settings.max_open_positions,
      maxDailyLossPct: settings.max_daily_loss_pct,
      ...(settings.allowed_symbols ? { allowedSymbols: settings.allowed_symbols } : {}),
      killSwitch: settings.kill_switch
    }, { balance: balance.equity, marketPrice: ticker.lastPrice, openPositions: 0, dailyPnl: 0 });

    const { data: stored, error: insertError } = await supabase.from("signals").insert({
      account_id: account.id,
      raw_text: opp.rawSignal,
      parsed: preview,
      source: "chat",
      status: "preview"
    }).select("id").limit(1).maybeSingle();

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
        rawSignal: opp.rawSignal,
        historicalMatch: hist
      }
    });

    revalidatePath("/dashboard/chat");
    redirect("/dashboard/chat?tab=signals");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const message = error instanceof Error ? error.message : "Failed to analyze market pulse";
    redirect(`/dashboard/chat?error=${encodeURIComponent(message)}`);
  }
}

export async function enhanceSignalAction(formData: FormData): Promise<void> {
  try {
    const rawSignal = textField(formData, "rawSignal") || textField(formData, "rawText");
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const { data: rawAccount } = await supabase.from("exchange_accounts")
      .select("id, label, exchange, environment, api_key_enc, api_secret_enc, paper_balance")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!rawAccount) redirect("/dashboard/accounts");
    const account = accountConnectionSchema.parse(rawAccount);

    const client = createAccountClient(account);
    const parsed = parseSignalText(rawSignal, "chat");
    const [balance, instrument, ticker] = await Promise.all([
      client.getBalance(),
      client.getInstrument(parsed.symbol),
      client.getTicker(parsed.symbol)
    ]);

    const enhanced = await enhanceNemotronSignal(rawSignal, ticker.lastPrice, instrument.tickSize);

    const { data: rawSettings } = await supabase.from("risk_settings")
      .select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, allowed_symbols, kill_switch")
      .eq("account_id", account.id)
      .limit(1)
      .maybeSingle();
    const settings = rawSettings ? riskRow.parse(rawSettings) : {
      risk_per_trade_pct: 1,
      max_leverage: 5,
      max_open_positions: 3,
      max_daily_loss_pct: 5,
      allowed_symbols: null,
      kill_switch: false
    };

    const preview = createTradePreview(enhanced.parsedSignal, instrument, {
      riskPerTradePct: settings.risk_per_trade_pct,
      maxLeverage: settings.max_leverage,
      maxOpenPositions: settings.max_open_positions,
      maxDailyLossPct: settings.max_daily_loss_pct,
      ...(settings.allowed_symbols ? { allowedSymbols: settings.allowed_symbols } : {}),
      killSwitch: settings.kill_switch
    }, { balance: balance.equity, marketPrice: ticker.lastPrice, openPositions: 0, dailyPnl: 0 });

    const { data: stored, error: insertError } = await supabase.from("signals").insert({
      account_id: account.id,
      raw_text: enhanced.rawText,
      parsed: preview,
      source: "chat",
      status: "preview"
    }).select("id").limit(1).maybeSingle();

    if (insertError || !stored) {
      redirect(`/dashboard/chat?error=${encodeURIComponent(insertError?.message ?? "Failed to save enhanced signal")}`);
    }

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
    redirect("/dashboard/chat?tab=signals");
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const message = error instanceof Error ? error.message : "Failed to enhance signal";
    redirect(`/dashboard/chat?error=${encodeURIComponent(message)}`);
  }
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

    const words = rawText.toUpperCase().split(/\s+/);
    const isScanRequest = rawText.toLowerCase().includes("scan") || (!rawText.includes("LONG") && !rawText.includes("SHORT"));
    if (isScanRequest) {
      const isUniverse = rawText.toUpperCase().includes("ALL") || rawText.toUpperCase().includes("UNIVERSE") || rawText.toUpperCase().includes("ВСЕ") || rawText.toUpperCase().includes("РИНОК");
      const isModerateScan = rawText.toLowerCase().includes("помірн") || rawText.toLowerCase().includes("стабільн") || rawText.toLowerCase().includes("moderate");
      let targetSymbol: string;
      if (isUniverse || isModerateScan) {
        const topOpps = await fetchTopUniverseOpportunities(1, fetch, isModerateScan ? "moderate" : "balanced");
        targetSymbol = topOpps[0]?.symbol ?? "SOLUSDT";
      } else {
        const cleanWords = words
          .map(w => w.replace(/[^A-Z0-9]/g, ""))
          .filter(w => !["SCAN", "AI", "PAIR", "ANALYZE", "CHECK", "TOKEN", "COIN", "SIGNAL", "FIND", "SETUP"].includes(w) && w.length >= 2);
        targetSymbol = cleanWords.find(w => w.endsWith("USDT")) ?? cleanWords[0] ?? "BTCUSDT";
        if (!targetSymbol.endsWith("USDT")) targetSymbol = `${targetSymbol}USDT`;
      }

      const [ticker, instrument, klines] = await Promise.all([
        client.getTicker(targetSymbol),
        client.getInstrument(targetSymbol),
        fetchRecentKlines(targetSymbol, "15", 15).catch(() => [])
      ]);

      const hist = findHistoricalPatternMatch(targetSymbol, "liquidity_sweep", 2.5, klines);
      const opp = await generateNemotronOpportunity(targetSymbol, ticker.lastPrice, {
        tickSize: instrument.tickSize,
        historicalContext: hist,
        klines
      });

      if (opp.side === "no_trade" || opp.decision === "NO_TRADE") {
        await supabase.from("chat_messages").insert([
          { account_id: account.id, role: "user", kind: "user_signal", content: rawText },
          {
            account_id: account.id,
            role: "assistant",
            kind: "system_alert",
            content: `🛡️ Nemotron AI: Вхід по ${opp.symbol} не рекомендовано (NO_TRADE).\n${opp.rationale}`,
            payload: {
              opportunity: opp,
              historicalMatch: hist
            }
          }
        ]);
        revalidatePath("/dashboard/chat");
        return { error: `Nemotron AI: Вхід по ${opp.symbol} не рекомендовано (NO_TRADE). ${opp.rejectionReason || opp.rationale}` };
      }

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
            rawSignal: opp.rawSignal,
            historicalMatch: hist
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
  const marginStr = textField(formData, "margin");
  const customMargin = marginStr && !isNaN(Number(marginStr)) && Number(marginStr) > 0 ? Number(marginStr) : undefined;

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 1. Fetch the signal details
  const { data: signalRow, error: signalErr } = await supabase
    .from("signals")
    .select("id, account_id, raw_text, parsed, status")
    .eq("id", signalId)
    .single();

  if (signalErr || !signalRow) {
    revalidatePath("/dashboard/chat");
    redirect("/dashboard/chat?error=Signal+not+found");
  }

  // Check if an active position already exists for this signal
  const { data: existingTrade } = await supabase
    .from("trades")
    .select("id, symbol, status")
    .eq("signal_id", signalId)
    .in("status", ["entry_open", "active"])
    .maybeSingle();

  if (existingTrade) {
    revalidatePath("/dashboard/chat");
    redirect(`/dashboard/chat?error=${encodeURIComponent(`Позиція по ${existingTrade.symbol} вже відкрита та активна на терміналі`)}`);
  }

  // Transition signal to confirmed if in preview
  if (signalRow.status === "preview") {
    await supabase.rpc("confirm_signal", { target_signal_id: signalId });
  }

  const signal = z.object({
    id: z.string().uuid(),
    account_id: z.string().uuid(),
    raw_text: z.string().nullable().optional(),
    parsed: z.unknown().optional()
  }).parse(signalRow);

  // 3. Fetch account
  const { data: rawAccount, error: accErr } = await supabase
    .from("exchange_accounts")
    .select("id, user_id, label, exchange, environment, api_key_enc, api_secret_enc, paper_balance")
    .eq("id", signal.account_id)
    .eq("user_id", user.id)
    .single();

  if (accErr || !rawAccount) {
    revalidatePath("/dashboard/chat");
    redirect("/dashboard/chat?error=Account+not+found");
  }

  const account = accountConnectionSchema.parse(rawAccount);

  // 4. Fetch risk settings
  const { data: rawSettings } = await supabase
    .from("risk_settings")
    .select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, allowed_symbols, kill_switch")
    .eq("account_id", account.id)
    .maybeSingle();

  const settings = rawSettings ? riskRow.parse(rawSettings) : {
    risk_per_trade_pct: 1,
    max_leverage: 5,
    max_open_positions: 3,
    max_daily_loss_pct: 5,
    allowed_symbols: null,
    kill_switch: false
  };

  if (settings.kill_switch) {
    await supabase.from("chat_messages").insert({
      account_id: account.id,
      role: "system",
      kind: "error",
      content: "Execution blocked: Emergency Kill Switch is ACTIVE for this account",
      payload: { signalId }
    });
    redirect("/dashboard/chat?error=Execution+blocked:+Emergency+Kill+Switch+is+ACTIVE");
  }

  // Check open positions count
  const { count: openPositions } = await supabase
    .from("trades")
    .select("id", { count: "exact", head: true })
    .eq("account_id", account.id)
    .in("status", ["entry_open", "active"]);

  if ((openPositions ?? 0) >= settings.max_open_positions) {
    const errorMsg = `Open positions limit (${settings.max_open_positions}) reached`;
    await supabase.from("chat_messages").insert({
      account_id: account.id,
      role: "system",
      kind: "error",
      content: `❌ ${errorMsg}`,
      payload: { signalId }
    });
    redirect(`/dashboard/chat?error=${encodeURIComponent(errorMsg)}`);
  }

  try {
    // 5. Create exchange client
    const client = account.exchange === "paper"
      ? createPaperExchangeClient({ balance: account.paper_balance ?? 0 })
      : (() => {
          if (!account.api_key_enc || !account.api_secret_enc) {
            throw new Error("Exchange API credentials missing");
          }
          const masterKey = process.env.ENCRYPTION_MASTER_KEY;
          if (!masterKey) throw new Error("ENCRYPTION_MASTER_KEY is not configured");
          return createBybitClient({
            apiKey: decryptSecret(account.api_key_enc, masterKey),
            apiSecret: decryptSecret(account.api_secret_enc, masterKey),
            environment: account.environment
          });
        })();

    // 6. Build or extract preview with customMargin if supplied
    let preview: TradePreview | undefined;
    const rawParsed = signal.parsed;
    let parsedSignal: Signal | null = null;

    if (rawParsed && typeof rawParsed === "object" && "signal" in rawParsed && "entryPrice" in rawParsed && "qty" in rawParsed) {
      if (!customMargin) {
        preview = rawParsed as TradePreview;
      } else {
        parsedSignal = (rawParsed as TradePreview).signal;
      }
    } else if (rawParsed && typeof rawParsed === "object" && "symbol" in rawParsed && "side" in rawParsed) {
      parsedSignal = rawParsed as Signal;
    } else {
      parsedSignal = parseSignalText(signal.raw_text ?? "", "chat");
    }

    if (!preview) {
      const sym = parsedSignal?.symbol ?? "BTCUSDT";
      const [balance, instrument, ticker] = await Promise.all([
        client.getBalance(),
        client.getInstrument(sym),
        client.getTicker(sym)
      ]);
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const { data: pnlRows } = await supabase.from("trades")
        .select("realized_pnl")
        .eq("account_id", account.id)
        .gte("closed_at", dayStart.toISOString());
      const dailyPnl = (pnlRows ?? []).reduce((sum: number, row: { realized_pnl: unknown }) => sum + Number(row.realized_pnl ?? 0), 0);

      preview = createTradePreview(parsedSignal!, instrument, {
        riskPerTradePct: settings.risk_per_trade_pct,
        maxLeverage: settings.max_leverage,
        maxOpenPositions: settings.max_open_positions,
        maxDailyLossPct: settings.max_daily_loss_pct,
        ...(settings.allowed_symbols ? { allowedSymbols: settings.allowed_symbols } : {}),
        killSwitch: settings.kill_switch
      }, {
        balance: balance.equity,
        marketPrice: ticker.lastPrice,
        openPositions: openPositions ?? 0,
        dailyPnl,
        ...(customMargin ? { customMargin } : {})
      });
    }

    // 7. Persist trade
    const tradeRes = await supabase.from("trades").insert({
      account_id: account.id,
      signal_id: signalId,
      symbol: preview.signal.symbol,
      side: preview.signal.side,
      status: "active",
      entry_avg: preview.entryPrice,
      qty: preview.qty,
      leverage: preview.leverage,
      sl: preview.signal.stopLoss,
      trailing_stop: preview.signal.trailingStop ?? null,
      opened_at: new Date().toISOString()
    }).select("id").single();

    if (tradeRes.error || !tradeRes.data) {
      throw new Error(`Failed to persist trade: ${tradeRes.error?.message}`);
    }
    const tradeId = String(tradeRes.data.id);

    // 8. Submit entry order
    const entryResult = await submitEntry(client, preview, tradeId);

    // Persist entry order
    await supabase.from("orders").insert({
      trade_id: tradeId,
      exchange_order_id: entryResult.entryOrder.orderId,
      order_link_id: entryResult.entryOrder.orderLinkId ?? `entry-${tradeId}`,
      type: preview.signal.entry.type === "market" ? "market" : "limit",
      side: preview.signal.side === "long" ? "buy" : "sell",
      price: preview.entryPrice,
      qty: preview.qty,
      status: "filled",
      reduce_only: false,
      raw: { preview: JSON.parse(JSON.stringify(preview)) as Record<string, unknown>, exchange: account.exchange }
    });

    // 9. Protect filled position with exchange SL and TP
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

    // 10. Mark execution job completed if possible
    try {
      await supabase.from("execution_jobs").update({
        status: "completed",
        locked_at: null,
        last_error: null
      }).eq("signal_id", signalId);
    } catch {
      // non-fatal if RLS restricts job update
    }

    // 11. Add chat message confirmation
    await supabase.from("chat_messages").insert({
      account_id: account.id,
      role: "system",
      kind: "order_event",
      content: `⚡ Позицію успішно відкрито: ${preview.signal.symbol} ${preview.signal.side.toUpperCase()} ${preview.qty} по $${formatCryptoPrice(preview.entryPrice)} (${preview.leverage}x). Встановлено SL ($${formatCryptoPrice(preview.signal.stopLoss)}) та ${protection.takeProfitOrders.length} рівні Take Profit.`,
      payload: { tradeId, preview: JSON.parse(JSON.stringify(preview)) as Record<string, unknown> }
    });

    revalidatePath("/dashboard/chat");
    revalidatePath("/dashboard/positions");
    revalidatePath("/dashboard/history");
    revalidatePath("/dashboard/profile");
    revalidatePath("/dashboard");
    redirect("/dashboard/chat?executed=1");
  } catch (execError) {
    if (isRedirectError(execError)) throw execError;
    const msg = execError instanceof Error ? execError.message : "Execution failed";
    await supabase.from("chat_messages").insert({
      account_id: signal.account_id,
      role: "system",
      kind: "error",
      content: `❌ Помилка відкриття ордера: ${msg}`,
      payload: { signalId, error: msg }
    });
    redirect(`/dashboard/chat?error=${encodeURIComponent(msg)}`);
  }
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
