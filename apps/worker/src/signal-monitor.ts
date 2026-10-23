import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateSignalOutcome, type SignalOutcomeStatus } from "@crypto-bot/trading";
import { logger } from "./logger";

interface OutcomeRow {
  id: string;
  signal_id: string;
  symbol: string;
  side: "long" | "short";
  entry_price: number | string;
  stop_loss: number | string;
  tp1: number | string;
  tp2: number | string | null;
  tp3: number | string | null;
  status: SignalOutcomeStatus;
  max_favorable_pct: number | string;
  max_adverse_pct: number | string;
  expires_at: string;
  strategy: string | null;
  features: Record<string, unknown> | null;
}

export function startSignalOutcomeMonitor(supabase: SupabaseClient, intervalMs = 10_000): () => void {
  let isRunning = true;
  let cycleRunning = false;
  logger.info({ intervalMs }, "Starting signal outcome learning monitor...");

  async function runCycle() {
    if (cycleRunning) return;
    cycleRunning = true;
    try {
      const { data, error } = await supabase
        .from("signal_outcomes")
        .select("id, signal_id, symbol, side, entry_price, stop_loss, tp1, tp2, tp3, status, max_favorable_pct, max_adverse_pct, expires_at, strategy, features")
        .in("status", ["monitoring", "tp1_hit", "tp2_hit"])
        .limit(500);
      if (error || !data?.length) return;

      const outcomes = data as unknown as OutcomeRow[];
      const tickerResponse = await fetch("https://api.bybit.com/v5/market/tickers?category=linear", {
        headers: { "User-Agent": "Vexqora-Signal-Learning", "Accept": "application/json" }
      });
      if (!tickerResponse.ok) return;
      const tickerJson = await tickerResponse.json() as { result?: { list?: Array<{ symbol: string; lastPrice: string }> } };
      const prices = new Map((tickerJson.result?.list ?? []).map((ticker) => [ticker.symbol, Number(ticker.lastPrice)]));
      const now = new Date();

      for (const row of outcomes) {
        const currentPrice = prices.get(row.symbol);
        if (!currentPrice || currentPrice <= 0) continue;

        const result = evaluateSignalOutcome({
          side: row.side,
          entryPrice: Number(row.entry_price),
          stopLoss: Number(row.stop_loss),
          tp1: Number(row.tp1),
          tp2: row.tp2 === null ? null : Number(row.tp2),
          tp3: row.tp3 === null ? null : Number(row.tp3),
          status: row.status,
          maxFavorablePct: Number(row.max_favorable_pct),
          maxAdversePct: Number(row.max_adverse_pct),
          expiresAt: row.expires_at
        }, currentPrice, now);

        const nowIso = now.toISOString();
        const updates: Record<string, unknown> = {
          status: result.status,
          last_price: currentPrice,
          max_favorable_pct: result.maxFavorablePct,
          max_adverse_pct: result.maxAdversePct,
          last_evaluated_at: nowIso,
          ...(result.tp1Hit && row.status === "monitoring" ? { tp1_hit_at: nowIso } : {}),
          ...(result.tp2Hit && row.status !== "tp2_hit" ? { tp2_hit_at: nowIso } : {}),
          ...(result.tp3Hit ? { tp3_hit_at: nowIso } : {}),
          ...(result.stopHit ? { stop_hit_at: nowIso } : {}),
          ...(result.resolved ? {
            outcome: result.outcome,
            failure_reason: result.failureReason,
            resolved_at: nowIso
          } : {})
        };
        const { error: updateError } = await supabase.from("signal_outcomes").update(updates).eq("id", row.id);
        if (updateError) continue;

        if (result.resolved && result.outcome) {
          await supabase.from("signal_learning_events").upsert({
            signal_id: row.signal_id,
            symbol: row.symbol,
            side: row.side,
            strategy: row.strategy,
            outcome: result.outcome,
            failure_reason: result.failureReason,
            max_favorable_pct: result.maxFavorablePct,
            max_adverse_pct: result.maxAdversePct,
            features: { ...(row.features ?? {}), resolutionPrice: currentPrice }
          }, { onConflict: "signal_id", ignoreDuplicates: true });

          logger.info({ signalId: row.signal_id, symbol: row.symbol, outcome: result.outcome, reason: result.failureReason }, "Signal resolved for Vexqora learning dataset");
        }
      }
    } catch (error) {
      logger.error({ error }, "Signal outcome monitor cycle failed");
    } finally {
      cycleRunning = false;
    }
  }

  void runCycle();
  const timer = setInterval(() => { if (isRunning) void runCycle(); }, intervalMs);
  return () => {
    isRunning = false;
    clearInterval(timer);
  };
}
