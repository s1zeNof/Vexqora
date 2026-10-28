import {
  generateNemotronOpportunity,
  VexqoraPulseScanner,
  evaluateMarketMicrostructure,
  classifyKlinesRegime,
  calculateBtcDependency,
  defaultThesisStore,
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

interface WorkerActiveTradeRow {
  id: string;
  account_id: string;
  symbol: string;
  side: "long" | "short";
  entry_avg?: number | string | null;
  sl?: number | string | null;
  trailing_stop?: unknown;
  status: string;
  metadata?: Record<string, unknown> | null;
}

interface WorkerPendingSignalRow {
  id: string;
  symbol: string;
  side: "long" | "short";
  metadata?: Record<string, unknown> | null;
}

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

              // A. Real per-position re-evaluation (P0-05)
              try {
                const { data: activeTrades } = await supabase
                  .from("trades")
                  .select("id, account_id, symbol, side, entry_avg, sl, trailing_stop, status, metadata")
                  .eq("status", "active");

                const tradeList = (activeTrades ?? []) as unknown as WorkerActiveTradeRow[];
                if (tradeList.length > 0) {
                  for (const trade of tradeList) {
                    const tradeSymbol = String(trade.symbol);
                    const altKlines = await fetchRecentKlines(tradeSymbol, "15", 30).catch(() => []);
                    const dependency = calculateBtcDependency(tradeSymbol, altKlines, btcKlines);

                    const isLong = trade.side === "long";
                    const btcTurnedBearish = currentBtcRegime === "bearish_trend";
                    const btcTurnedBullish = currentBtcRegime === "bullish_trend";
                    const hasContradiction = (isLong && btcTurnedBearish) || (!isLong && btcTurnedBullish);

                    const thesisKey = `thesis-trade-${trade.id}`;
                    const existingThesis = await defaultThesisStore.getThesis(thesisKey);
                    const updatedStatus: "VALID" | "WEAKENED" | "INVALIDATED" = hasContradiction ? "WEAKENED" : "VALID";

                    await defaultThesisStore.saveThesis({
                      thesisId: thesisKey,
                      tradeId: trade.id,
                      accountId: trade.account_id,
                      symbol: tradeSymbol,
                      side: trade.side,
                      status: updatedStatus,
                      revision: existingThesis ? existingThesis.revision + 1 : 1,
                      entryPrice: Number(trade.entry_avg ?? 0),
                      invalidationPrice: Number(trade.sl ?? 0),
                      primaryRationale: `BTC Regime Shift ${lastBtcRegime} -> ${currentBtcRegime}. Dependency Beta: ${dependency.betaToBtc ?? "unknown"}.`,
                      invalidationTrigger: `Підтверджене пробиття Stop Loss: $${String(trade.sl ?? "N/A")}`,
                      supportingEvidence: [
                        `BTC regime: ${currentBtcRegime}`,
                        `Symbol correlation: ${dependency.rollingCorrelation1h ?? "N/A"}`
                      ],
                      opposingEvidence: hasContradiction ? [`BTC flipped to ${currentBtcRegime} (anti-position momentum)`] : [],
                      createdAtMs: existingThesis?.createdAtMs ?? Date.now(),
                      updatedAtMs: Date.now()
                    });

                    // Update trade record with reassessment audit
                    const existingMeta: Record<string, unknown> = typeof trade.metadata === "object" && trade.metadata ? trade.metadata : {};
                    await supabase.from("trades").update({
                      metadata: {
                        ...existingMeta,
                        btc_regime_reassessed_at: Date.now(),
                        btc_regime_from: lastBtcRegime,
                        btc_regime_to: currentBtcRegime,
                        regime_contradiction: hasContradiction,
                        beta_to_btc: dependency.betaToBtc,
                        requires_reassessment: hasContradiction
                      }
                    }).eq("id", trade.id);

                    // Insert AI companion analysis for this specific trade
                    const { data: session } = await supabase
                      .from("trade_ai_sessions")
                      .select("id")
                      .eq("trade_id", trade.id)
                      .maybeSingle();

                    if (session && typeof session.id === "string") {
                      const tradeSideStr = String(trade.side).toUpperCase();
                      await supabase.from("trade_ai_messages").insert({
                        session_id: session.id,
                        author_kind: "lead",
                        agent_id: "lead_trade_agent",
                        kind: "analysis",
                        content: hasContradiction
                          ? `⚠️ **Lead Agent Re-Assessment:** Виявлено глобальну зміну режиму BTC (${lastBtcRegime.toUpperCase()} → ${currentBtcRegime.toUpperCase()}).\n` +
                            `Позиція ${tradeSymbol} (${tradeSideStr}) має бета-чутливість до BTC ${dependency.betaToBtc ?? "N/A"}. ` +
                            `Гіпотезу угоди переведено у статус WEAKENED. Рекомендується захисне підтягування Stop Loss або часткове скорочення об'єму.`
                          : `ℹ️ **Lead Agent BTC Context:** Режим BTC перейшов у ${currentBtcRegime.toUpperCase()}. ` +
                            `Позиція ${tradeSymbol} (${tradeSideStr}) узгоджена з динамікою ринку. Гіпотеза залишається валідною.`,
                        structured_payload: {
                          event: "BTC_REGIME_REASSESSMENT",
                          tradeId: trade.id,
                          symbol: tradeSymbol,
                          side: trade.side,
                          fromRegime: lastBtcRegime,
                          toRegime: currentBtcRegime,
                          betaToBtc: dependency.betaToBtc,
                          correlation: dependency.rollingCorrelation1h,
                          thesisStatus: updatedStatus,
                          timestampMs: Date.now()
                        }
                      });
                    }
                  }
                }
              } catch (reassessErr) {
                logger.warn({ err: reassessErr }, "Error during per-trade BTC shift re-evaluation");
              }

              // B. Per-signal pending review
              try {
                const { data: pendingSignals } = await supabase
                  .from("signals")
                  .select("id, symbol, side, metadata")
                  .eq("status", "pending");

                const signalList = (pendingSignals ?? []) as unknown as WorkerPendingSignalRow[];
                if (signalList.length > 0) {
                  for (const sig of signalList) {
                    const isContradiction =
                      (sig.side === "long" && currentBtcRegime === "bearish_trend") ||
                      (sig.side === "short" && currentBtcRegime === "bullish_trend");

                    if (isContradiction) {
                      const sigMeta: Record<string, unknown> = typeof sig.metadata === "object" && sig.metadata ? sig.metadata : {};
                      await supabase.from("signals").update({
                        metadata: {
                          ...sigMeta,
                          btc_regime_conflict: true,
                          regime_at_review: currentBtcRegime,
                          reassessed_at: Date.now()
                        }
                      }).eq("id", sig.id);
                    }
                  }
                }
              } catch (sigErr) {
                logger.warn({ err: sigErr }, "Error during pending signals BTC shift review");
              }

              // C. Account broadcast notification
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
                    content: `⚠️ BTC REGIME SHIFT: Біткоїн перейшов із ${lastBtcRegime.toUpperCase()} у ${currentBtcRegime.toUpperCase()}. Всі активні гіпотези альткоїнів переоцінено 24/7 воркером.`,
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
                    opp.executionEvidence?.structureEvidence.status !== "REJECTED"
                  ) {
                    const expiresAt = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
                    const originKey = `ai-pulse-${anomaly.id}`;
                    const { data: existingSignal } = await supabase
                      .from("signals")
                      .select("id")
                      .eq("account_id", account.id)
                      .eq("origin_key", originKey)
                      .maybeSingle();
                    const signalInsert = existingSignal
                      ? { data: existingSignal, error: null }
                      : await supabase.from("signals").insert({
                        account_id: account.id,
                        origin_key: originKey,
                        raw_text: opp.rawSignal,
                        parsed: {
                          signal: opp.parsedSignal,
                          entryPrice: opp.entryPrice,
                          opportunity: opp,
                          executionEvidence: opp.executionEvidence
                        },
                        source: "chat",
                        status: "preview",
                        expires_at: expiresAt
                      })
                      .select("id")
                      .maybeSingle();
                    const { data: storedSignal, error: signalError } = signalInsert;

                    if (signalError || !storedSignal) {
                      throw signalError ?? new Error("Failed to persist AI pulse signal");
                    }

                    await supabase.from("chat_messages").insert({
                      account_id: account.id,
                      role: "assistant",
                      kind: "ai_signal",
                      content: `Vexqora Signal: ${opp.symbol} ${opp.side.toUpperCase()} (${opp.strategy})`,
                      payload: {
                        opportunity: opp,
                        signalId: String(storedSignal.id),
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
