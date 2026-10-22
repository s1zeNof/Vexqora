import {
  generateNemotronOpportunity,
  VexqoraPulseScanner,
  type BybitTickerItem
} from "@crypto-bot/trading";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";

export function startPulseScanner(
  supabase: SupabaseClient,
  intervalMs: number = 10000
): () => void {
  const scanner = new VexqoraPulseScanner();
  let isRunning = true;

  logger.info({ intervalMs }, "Starting 24/7 Vexqora Pulse Universe Scanner (Bybit Linear)...");

  async function scanCycle() {
    try {
      const res = await fetch("https://api.bybit.com/v5/market/tickers?category=linear");
      if (!res.ok) return;

      const data = (await res.json()) as { result?: { list?: BybitTickerItem[] } };
      const tickers = data.result?.list ?? [];
      if (tickers.length === 0) return;

      const anomalies = scanner.processTickers(tickers);

      if (anomalies.length > 0) {
        logger.info({ anomalyCount: anomalies.length }, "Vexqora Pulse anomalies detected in universe");

        // Fetch active accounts to broadcast pulse
        const { data: accounts } = await supabase
          .from("exchange_accounts")
          .select("id, exchange, environment")
          .eq("is_active", true);

        if (accounts && accounts.length > 0) {
          for (const anomaly of anomalies.slice(0, 3)) {
            for (const account of accounts) {
              // Publish pulse event
              await supabase.from("chat_messages").insert({
                account_id: account.id,
                role: "system",
                kind: "market_pulse",
                content: `${anomaly.symbol} ${anomaly.changePct > 0 ? "+" : ""}${anomaly.changePct}% in ${anomaly.timeframeSec}s · ${anomaly.eventType.replace("_", " ").toUpperCase()}`,
                payload: {
                  pulse: anomaly,
                  symbol: anomaly.symbol,
                  changePct: anomaly.changePct,
                  timeframeSec: anomaly.timeframeSec,
                  price: anomaly.price,
                  turnover24h: anomaly.turnover24h,
                  eventType: anomaly.eventType,
                  historicalMatch: anomaly.historicalMatch
                }
              });

              // If anomaly detected (>=1.2% rapid momentum, sweep or breakout), evaluate for AI Signal
              if (Math.abs(anomaly.changePct) >= 1.2 || anomaly.eventType === "volume_spike") {
                try {
                  const opp = await generateNemotronOpportunity(anomaly.symbol, anomaly.price, {
                    historicalContext: anomaly.historicalMatch
                  });

                  if (opp.qualityScore >= 8.5) {
                    await supabase.from("chat_messages").insert({
                      account_id: account.id,
                      role: "assistant",
                      kind: "ai_signal",
                      content: `Vexqora Signal: ${opp.symbol} ${opp.side.toUpperCase()} (${opp.strategy})`,
                      payload: {
                        opportunity: opp,
                        rawSignal: opp.rawSignal,
                        historicalMatch: anomaly.historicalMatch,
                        triggeredByPulse: anomaly.id
                      }
                    });
                  }
                } catch (nemotronErr) {
                  logger.warn({ symbol: anomaly.symbol, err: nemotronErr }, "Nemotron pulse evaluation error");
                }
              }
            }
          }
        }
      }
    } catch (err) {
      logger.error({ err }, "Error in Pulse scanner cycle");
    }
  }

  // Initial scan to seed snapshot
  void scanCycle();

  const timer = setInterval(() => {
    if (isRunning) {
      void scanCycle();
    }
  }, intervalMs);

  return () => {
    isRunning = false;
    clearInterval(timer);
    logger.info("Vexqora Pulse Scanner stopped.");
  };
}
