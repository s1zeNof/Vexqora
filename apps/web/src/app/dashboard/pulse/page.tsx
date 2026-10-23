import { fetchTopUniverseOpportunities } from "@crypto-bot/trading";
import { PulseFeedClient, type PulseSignalItem } from "./pulse-feed-client";

export default async function PulsePage() {
  const topOpps = await fetchTopUniverseOpportunities(12).catch(() => []);

  // Map opportunities to PulseSignalItem
  const signals: PulseSignalItem[] = topOpps.map((opp, idx) => {
    const isLong = opp.change24hPct >= 0;
    const side = isLong ? ("long" as const) : ("short" as const);
    const absChange = Math.abs(opp.change24hPct);

    let triggerType: "spike" | "volume" | "breakout" | "rejection" = "breakout";
    let trigger = `Breakout · ${isLong ? "+" : "−"}${absChange}% / 15m`;

    if (opp.anomalyType === "volatility_expansion" || absChange >= 10) {
      triggerType = "spike";
      trigger = `Price spike · ${isLong ? "+" : "−"}${absChange}% / 10m`;
    } else if (opp.anomalyType === "volume_breakout") {
      triggerType = "volume";
      const volMult = (opp.turnover24h / 15_000_000).toFixed(1);
      trigger = `Volume · ×${volMult} / 15m`;
    } else if (!isLong) {
      triggerType = "rejection";
      trigger = `Rejection · −${absChange}% / 5m`;
    }

    const entry = opp.lastPrice;
    const slDist = entry * 0.025; // 2.5% stop
    const stopLoss = isLong ? entry - slDist : entry + slDist;
    const tp1Dist = slDist * 1.8;
    const tp1 = isLong ? entry + tp1Dist : entry - tp1Dist;
    const rr = 1.8;

    // Confidence: 60 - 78%
    const baseConf = 62;
    const turnoverBonus = Math.min(8, Math.round(opp.turnover24h / 50_000_000));
    const momentumBonus = Math.min(8, Math.round(absChange / 2));
    const confidence = Math.min(82, baseConf + turnoverBonus + momentumBonus - (idx % 3));

    const minutesAgo = idx * 3 + 2;
    const age = `${minutesAgo}m ago`;

    return {
      id: `pulse-${opp.symbol}-${idx}`,
      symbol: opp.symbol,
      exchange: "bybit" as const,
      market: "linear" as const,
      side,
      trigger,
      triggerType,
      entry,
      stopLoss,
      tp1,
      rr,
      confidence,
      createdAt: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
      age,
      status: "active" as const
    };
  });

  return <PulseFeedClient initialSignals={signals} />;
}
