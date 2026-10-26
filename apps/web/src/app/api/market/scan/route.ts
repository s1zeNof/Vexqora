import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { accountConnectionSchema, createAccountClient } from "../../../../lib/account-client";
import { fetchRecentKlines } from "@crypto-bot/exchange";
import {
  fetchTopUniverseOpportunities,
  generateNemotronOpportunity,
  findHistoricalPatternMatch,
  createTradePreview,
  type UniverseScanFilter
} from "@crypto-bot/trading";

const riskRow = z.object({
  risk_per_trade_pct: z.coerce.number(),
  max_leverage: z.coerce.number(),
  max_open_positions: z.coerce.number(),
  max_daily_loss_pct: z.coerce.number(),
  allowed_symbols: z.array(z.string()).nullable(),
  kill_switch: z.boolean()
});

export async function POST(request: NextRequest) {
  try {
    let body: { symbol?: string; filter?: string } = {};
    try {
      body = (await request.json()) as { symbol?: string; filter?: string };
    } catch {
      body = {};
    }

    const rawSymbol = (body.symbol || "UNIVERSE").toUpperCase().trim();
    const rawFilter = (body.filter || "balanced").toLowerCase();
    const scanFilter: UniverseScanFilter =
      rawFilter === "moderate" || rawFilter === "помірні" || rawFilter === "steady"
        ? "moderate"
        : rawFilter === "momentum"
          ? "momentum"
          : rawFilter === "volatile"
            ? "volatile"
            : "balanced";

    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: rawAccount, error: accountError } = await supabase.from("exchange_accounts")
      .select("id, label, exchange, environment, api_key_enc, api_secret_enc, paper_balance")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (accountError || !rawAccount) {
      return NextResponse.json({ error: "Active account not found" }, { status: 400 });
    }

    const account = accountConnectionSchema.parse(rawAccount);

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

    const generatedSignals: Array<{ id: string; symbol: string; side: string; strategy: string }> = [];

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
          generatedSignals.push({
            id: storedSignal.id,
            symbol: opp.symbol,
            side: opp.side,
            strategy: opp.strategy
          });

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

    return NextResponse.json({
      success: true,
      count: generatedSignals.length,
      symbols: generatedSignals.map(s => s.symbol),
      signals: generatedSignals
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to scan market";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
