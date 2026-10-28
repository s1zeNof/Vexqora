import {
  generateNemotronOpportunity,
  VexqoraPulseScanner,
  evaluateMarketMicrostructure,
  classifyKlinesRegime,
  type BybitTickerItem
} from "@crypto-bot/trading";
import {
  fetchRecentKlines,
  fetchOrderBook,
  fetchRecentTrades,
  fetchOpenInterest
} from "@crypto-bot/exchange";
import type { Kline } from "@crypto-bot/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";

export function startPulseScanner(
  supabase: SupabaseClient,
  intervalMs: number = 10000
): () => void {
  const scanner = new VexqoraPulseScanner();
  let isRunning = true;
  let lastBtcRegime: string | null = null;

  logger.info({ intervalMs }, "Starting 24/7 Vexqora Pulse Universe Scanner (Bybit Linear)...");

  async function scanCycle() {
    try {
      const res = await fetch("https://api.bybit.com/v5/market/tickers?category=linear");
      if (!res.ok) return;

      const data = (await res.json()) as { result?: { list?: BybitTickerItem[] } };
      const tickers = data.result?.list ?? [];
      if (tickers.length === 0) return;

      // 1. Global Market Context: Monitor BTC Regime (P0-10, AT-01)
      const btcTicker = tickers.find(t => t.symbol === "BTCUSDT");
      if (btcTicker) {
        try {
          const btcKlines = await fetchRecentKlines("BTCUSDT", "15", 30).catch(() => []);
          if (btcKlines.length >= 20) {
            const currentBtcRegime = classifyKlinesRegime(btcKlines, "15M").trend;
            if (lastBtcRegime && lastBtcRegime !== currentBtcRegime) {
              logger.info({ from: lastBtcRegime, to: currentBtcRegime }, "BTC Global Regime Shift detected by Worker");
              const { data: accounts } = await supabase
                .from("exchange_accounts")
                .select("id")
                .eq("is_active", true);

              if (accounts && accounts.length > 0) {
                for (const account of accounts) {
                  await supabase.from("chat_messages").insert({
                    account_id: account.id,
                    role: "system",
                    kind: "market_pulse",
                    content: `⚠️ BTC REGIME SHIFT: Біткоїн перейшов із ${lastBtcRegime.toUpperCase()} у ${currentBtcRegime.toUpperCase()}. Всі активні гіпотези альткоїнів проходять переоцінку.`,
                    payload: {
                      event: "BTC_REGIME_CHANGE",
                      from: lastBtcRegime,
                      to: currentBtcRegime,
                      timestampMs: Date.now()
                    }
                  });
                }
              }
            }
            lastBtcRegime = currentBtcRegime;
          }
        } catch (btcErr) {
          logger.warn({ err: btcErr }, "Failed to monitor BTC regime");
        }
      }

      // 2. Discover anomalies across market universe
      const anomalies = scanner.processTickers(tickers);

      if (anomalies.length > 0) {
        logger.info({ anomalyCount: anomalies.length }, "Vexqora Pulse anomalies detected in universe");

        // Fetch active accounts to broadcast pulse
        const { data: accounts } = await supabase
          .from("exchange_accounts")
          .select("id, exchange, environment")
          .eq("is_active", true);

        if (accounts && accounts.length > 0) {
          for (const anomaly of anomalies.slice(0, 5)) {
            // Level 2: Microstructure deep dive (Order Book + Recent Trades + OI)
            let microstructure;
            let klines: Kline[] = [];
            try {
              const [ob, trades, klinesRes, oiPoints] = await Promise.all([
                fetchOrderBook(anomaly.symbol, 50).catch(() => null),
                fetchRecentTrades(anomaly.symbol, 100).catch(() => []),
                fetchRecentKlines(anomaly.symbol, "15", 25).catch(() => []),
                fetchOpenInterest(anomaly.symbol, 12).catch(() => [])
              ]);
              klines = klinesRes;
              microstructure = evaluateMarketMicrostructure({
                symbol: anomaly.symbol,
                orderBook: ob,
                trades,
                klines,
                oiPoints,
                priceChangePct: anomaly.changePct
              });
              anomaly.microstructure = microstructure;

              // Refine eventType if specific microstructure pattern detected
              if (microstructure.liquiditySweep.isSweep) {
                anomaly.eventType = "liquidity_sweep";
              } else if (microstructure.regime === "short_squeeze") {
                anomaly.eventType = "short_squeeze";
              } else if (microstructure.regime === "long_flush") {
                anomaly.eventType = "long_flush";
              } else if (
                microstructure.regime === "absorption_long" ||
                (microstructure.tape.whaleBuyVolumeUsd > 100_000 && microstructure.orderBook.weightedImbalance > 0.2)
              ) {
                anomaly.eventType = "whale_accumulation";
              } else if (
                microstructure.regime === "absorption_short" ||
                (microstructure.tape.whaleSellVolumeUsd > 100_000 && microstructure.orderBook.weightedImbalance < -0.2)
              ) {
                anomaly.eventType = "whale_distribution";
              }
            } catch (msErr) {
              logger.warn({ symbol: anomaly.symbol, err: msErr }, "Failed to fetch microstructure for anomaly");
            }

            for (const account of accounts) {
              const msTag = microstructure
                ? ` · OBI: ${microstructure.orderBook.weightedImbalance >= 0 ? "+" : ""}${Math.round(microstructure.orderBook.weightedImbalance * 100)}% · CVD: ${microstructure.tape.cvdUsd >= 0 ? "+" : ""}$${microstructure.tape.cvdUsd.toLocaleString()}`
                : "";

              // Publish pulse event with microstructure facts
              await supabase.from("chat_messages").insert({
                account_id: account.id,
                role: "system",
                kind: "market_pulse",
                content: `${anomaly.symbol} ${anomaly.changePct > 0 ? "+" : ""}${anomaly.changePct}% in ${anomaly.timeframeSec}s · ${anomaly.eventType.replace("_", " ").toUpperCase()}${msTag}`,
                payload: {
                  pulse: anomaly,
                  symbol: anomaly.symbol,
                  changePct: anomaly.changePct,
                  timeframeSec: anomaly.timeframeSec,
                  price: anomaly.price,
                  turnover24h: anomaly.turnover24h,
                  eventType: anomaly.eventType,
                  historicalMatch: anomaly.historicalMatch,
                  microstructure
                }
              });

              // Level 3: Evaluate for AI Signal with verified klines and microstructure
              if (
                Math.abs(anomaly.changePct) >= 0.70 ||
                anomaly.eventType === "volume_spike" ||
                anomaly.eventType === "whale_accumulation" ||
                anomaly.eventType === "whale_distribution" ||
                anomaly.eventType === "liquidity_sweep"
              ) {
                try {
                  const opp = await generateNemotronOpportunity(anomaly.symbol, anomaly.price, {
                    historicalContext: anomaly.historicalMatch,
                    klines,
                    microstructure
                  });

                  if (
                    opp.decision !== "NO_TRADE" &&
                    opp.side !== "no_trade" &&
                    opp.qualityScore >= 8.5 &&
                    (opp.winProbabilityPct === null || opp.winProbabilityPct >= 50)
                  ) {
                    await supabase.from("chat_messages").insert({
                      account_id: account.id,
                      role: "assistant",
                      kind: "ai_signal",
                      content: `Vexqora Signal: ${opp.symbol} ${opp.side.toUpperCase()} (${opp.strategy})`,
                      payload: {
                        opportunity: opp,
                        rawSignal: opp.rawSignal,
                        historicalMatch: anomaly.historicalMatch,
                        microstructure,
                        triggeredByPulse: anomaly.id
                      }
                    });
                  } else {
                    logger.info(
                      { symbol: anomaly.symbol, decision: opp.decision, qualityScore: opp.qualityScore, reason: opp.rejectionReason },
                      "Pulse anomaly evaluated by Nemotron: signal discarded or NO_TRADE (capital protected)"
                    );
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
