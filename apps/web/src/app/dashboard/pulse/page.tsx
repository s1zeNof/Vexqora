import { redirect } from "next/navigation";
import { fetchTopUniverseOpportunities, parseSignalText } from "@crypto-bot/trading";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { PulseFeedClient, type PulseSignalItem } from "./pulse-feed-client";

interface CanonicalPulsePayload {
  entryPrice: number;
  signal: ReturnType<typeof parseSignalText>;
  opportunity: {
    change24hPct: number;
    turnover24h: number;
    anomalyType: "volume_breakout" | "volatility_expansion" | "liquidity_hunt";
    confidence: number;
    riskReward: number;
    qualityScore: number;
    qualityTier: "A+" | "A" | "B+";
    winProbabilityPct: number;
    strategy: string;
    rationale: string;
  };
}

function toCard(id: string, createdAt: string, payload: CanonicalPulsePayload): PulseSignalItem {
  const { signal, opportunity } = payload;
  const absChange = Math.abs(opportunity.change24hPct);
  const triggerType: PulseSignalItem["triggerType"] =
    opportunity.anomalyType === "volatility_expansion" || absChange >= 10
      ? "spike"
      : opportunity.anomalyType === "volume_breakout"
        ? "volume"
        : signal.side === "short" ? "rejection" : "breakout";
  const trigger = triggerType === "spike"
    ? `Price spike · ${opportunity.change24hPct >= 0 ? "+" : "−"}${absChange}% / 10m`
    : triggerType === "volume"
      ? `Volume · ×${(opportunity.turnover24h / 15_000_000).toFixed(1)} / 15m`
      : triggerType === "rejection"
        ? `Rejection · −${absChange}% / 5m`
        : `Breakout · +${absChange}% / 15m`;

  return {
    id,
    symbol: signal.symbol,
    exchange: "bybit",
    market: "linear",
    side: signal.side,
    trigger,
    triggerType,
    entry: payload.entryPrice,
    stopLoss: signal.stopLoss,
    tp1: signal.takeProfits[0]?.price ?? payload.entryPrice,
    rr: opportunity.riskReward,
    confidence: opportunity.confidence,
    createdAt,
    age: "just now",
    status: "active"
  };
}

export default async function PulsePage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: account } = await supabase
    .from("exchange_accounts")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!account) redirect("/dashboard/accounts");

  const topOpps = await fetchTopUniverseOpportunities(12).catch(() => []);
  const bucket = Math.floor(Date.now() / (10 * 60 * 1000));

  const signals = await Promise.all(topOpps.map(async (opp, idx): Promise<PulseSignalItem> => {
    const side = opp.change24hPct >= 0 ? ("long" as const) : ("short" as const);
    const entry = opp.lastPrice;
    const slDistance = entry * 0.025;
    const stopLoss = side === "long" ? entry - slDistance : entry + slDistance;
    const tp1 = side === "long" ? entry + slDistance * 1.8 : entry - slDistance * 1.8;
    const tp2 = side === "long" ? entry + slDistance * 2.6 : entry - slDistance * 2.6;
    const tp3 = side === "long" ? entry + slDistance * 3.5 : entry - slDistance * 3.5;
    const confidence = Math.min(82, 62 + Math.min(8, Math.round(opp.turnover24h / 50_000_000)) + Math.min(8, Math.round(Math.abs(opp.change24hPct) / 2)) - (idx % 3));
    const rawText = `${opp.symbol} ${side.toUpperCase()}\nentry ${entry}\ntp ${tp1} 40%, ${tp2} 30%, ${tp3} 30%\nsl ${stopLoss}\ntrail 1% after tp1\nlev 5\nrisk 1%`;
    const payload: CanonicalPulsePayload = {
      entryPrice: entry,
      signal: parseSignalText(rawText, "api"),
      opportunity: {
        change24hPct: opp.change24hPct,
        turnover24h: opp.turnover24h,
        anomalyType: opp.anomalyType,
        confidence,
        riskReward: 1.8,
        qualityScore: Number((confidence / 10).toFixed(1)),
        qualityTier: confidence >= 75 ? "A" : "B+",
        winProbabilityPct: confidence,
        strategy: opp.anomalyType === "volatility_expansion" ? "Momentum Expansion" : opp.anomalyType === "volume_breakout" ? "Volume Breakout" : "Liquidity Hunt",
        rationale: `Canonical ${side.toUpperCase()} setup captured at ${entry}. Levels are immutable and will be monitored for 48 hours.`
      }
    };
    const originKey = `pulse:${opp.symbol}:${side}:${bucket}`;

    let storedId: string | null = null;
    let storedCreatedAt: string | null = null;
    let storedParsed: unknown = null;

    const { data: existing } = await supabase
      .from("signals")
      .select("id, parsed, created_at")
      .eq("account_id", account.id)
      .eq("origin_key", originKey)
      .maybeSingle();

    const existingData = existing as { id?: string; parsed?: unknown; created_at?: string } | null;
    if (existingData?.id && existingData.created_at) {
      storedId = existingData.id;
      storedCreatedAt = existingData.created_at;
      storedParsed = existingData.parsed;
    } else {
      const inserted = await supabase.from("signals").insert({
        account_id: account.id,
        raw_text: rawText,
        parsed: payload,
        source: "api",
        status: "preview",
        origin_key: originKey,
        expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
      }).select("id, parsed, created_at").maybeSingle();

      const insertedData = inserted.data as { id?: string; created_at?: string; parsed?: unknown } | null;
      if (insertedData?.id && insertedData.created_at) {
        storedId = insertedData.id;
        storedCreatedAt = insertedData.created_at;
        storedParsed = insertedData.parsed;
      }
    }

    if (!storedId || !storedCreatedAt) {
      return toCard(`pulse-${opp.symbol}-${bucket}`, new Date().toISOString(), payload);
    }

    const canonical = (storedParsed as CanonicalPulsePayload | null) ?? payload;
    await supabase.from("signal_outcomes").upsert({
      signal_id: storedId,
      account_id: account.id,
      symbol: canonical.signal.symbol,
      side: canonical.signal.side,
      entry_price: canonical.entryPrice,
      stop_loss: canonical.signal.stopLoss,
      tp1: canonical.signal.takeProfits[0]?.price,
      tp2: canonical.signal.takeProfits[1]?.price ?? null,
      tp3: canonical.signal.takeProfits[2]?.price ?? null,
      strategy: canonical.opportunity.anomalyType,
      features: canonical.opportunity,
      expires_at: new Date(new Date(storedCreatedAt).getTime() + 48 * 60 * 60 * 1000).toISOString()
    }, { onConflict: "signal_id", ignoreDuplicates: true });

    return toCard(storedId, storedCreatedAt, canonical);
  }));

  return <PulseFeedClient initialSignals={signals} />;
}
