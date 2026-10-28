import type { Kline } from "@crypto-bot/shared";

export interface AdaptiveConfidenceInput {
  symbol: string;
  side: "long" | "short";
  change24hPct?: number | undefined;
  baseScore?: number | undefined;
  /** @deprecated Use baseScore instead. Heuristic quality baseline, not empirical win rate. */
  baseWinRate?: number | undefined;
  recentLossesCount?: number | undefined;
  recentWinsCount?: number | undefined;
  klines?: Kline[] | undefined;
}

export interface AdaptiveConfidenceResult {
  confidencePct: number;
  qualityScore: number;
  qualityTier: "A+" | "A" | "B" | "C" | "High Risk";
  penalties: Array<{ reason: string; deltaPct: number }>;
  bonuses: Array<{ reason: string; deltaPct: number }>;
  learningContext: string;
  isHighRisk: boolean;
  decision: "TRADE" | "NO_TRADE" | "WAIT_FOR_CONFIRMATION";
  rejectionReason?: string | undefined;
  provenance: "heuristic" | "calibrated";
  calibratedProbability: number | null;
}

/**
 * Adaptive Heuristic Confidence & Risk Engine.
 * Note: This produces a heuristic quality score (0..100), NOT a calibrated out-of-sample ML probability.
 * Provenance is tagged as "heuristic" and calibratedProbability is explicitly null.
 *
 * Dynamically adjusts heuristic confidence based on:
 * 1. Overextension risk (entering long after extreme 24h pump or short after dump).
 * 2. Recent loss feedback loop (penalizes symbols with recent immediate stop loss triggers).
 * 3. Candlestick wick absorption and exhaustion signals.
 */
export function calculateAdaptiveConfidence(
  input: AdaptiveConfidenceInput
): AdaptiveConfidenceResult {
  const base = input.baseScore ?? input.baseWinRate ?? 72;
  const penalties: Array<{ reason: string; deltaPct: number }> = [];
  const bonuses: Array<{ reason: string; deltaPct: number }> = [];

  const change24h = input.change24hPct ?? 0;
  const isLong = input.side === "long";

  // 1. Extreme 24h Overextension Check (Preventing FOMO Longs at the absolute peak)
  if (isLong && change24h >= 40) {
    penalties.push({
      reason: `Надмірний перегрів (+${change24h.toFixed(1)}% за 24г). Ризик каскаду фіксацій прибутку та ліквідацій`,
      deltaPct: 22
    });
  } else if (isLong && change24h >= 25) {
    penalties.push({
      reason: `Підвищений зсув (+${change24h.toFixed(1)}% за 24г). Зниження математичного очікування`,
      deltaPct: 14
    });
  } else if (!isLong && change24h <= -40) {
    penalties.push({
      reason: `Надмірна перепроданість (${change24h.toFixed(1)}% за 24г). Високий ризик short-squeeze`,
      deltaPct: 22
    });
  } else if (!isLong && change24h <= -25) {
    penalties.push({
      reason: `Глибока просадка (${change24h.toFixed(1)}% за 24г). Ризик відскоку від дна`,
      deltaPct: 14
    });
  }

  // 2. Post-Mortem Historical Loss Feedback on this symbol
  const losses = input.recentLossesCount ?? 0;
  if (losses >= 2) {
    penalties.push({
      reason: `Memory Feedback: ${losses} нещодавні інвалідації по Stop Loss на ${input.symbol}. Пастка ліквідності`,
      deltaPct: 18
    });
  } else if (losses === 1) {
    penalties.push({
      reason: `Memory Feedback: попередня угода по ${input.symbol} завершилась розворотом у Stop Loss`,
      deltaPct: 10
    });
  }

  // 3. Wins reinforcement
  const wins = input.recentWinsCount ?? 0;
  if (wins >= 2 && penalties.length === 0) {
    bonuses.push({
      reason: `Стабільне утримання структури (${wins} успішні фіксації тейків поспіль)`,
      deltaPct: 4
    });
  }

  // 4. Candlestick Wick Rejection Analysis (if klines provided)
  if (input.klines && input.klines.length >= 3) {
    const recent = input.klines.slice(-3);
    const last = recent[recent.length - 1]!;
    const bodySize = Math.abs(last.close - last.open);
    const totalRange = last.high - last.low;

    if (totalRange > 0 && bodySize > 0) {
      if (isLong) {
        const upperWick = last.high - Math.max(last.open, last.close);
        // Heavy rejection upper wick on long entry (>45% of entire candle)
        if (upperWick / totalRange > 0.45 && last.close < last.open) {
          penalties.push({
            reason: "Ведмеже відторгнення (довгий верхній гніт свічки, тиск продавців)",
            deltaPct: 9
          });
        }
      } else {
        const lowerWick = Math.min(last.open, last.close) - last.low;
        // Heavy absorption lower wick on short entry
        if (lowerWick / totalRange > 0.45 && last.close > last.open) {
          penalties.push({
            reason: "Бичаче поглинання (довгий нижній гніт свічки, агресивний відкуп)",
            deltaPct: 9
          });
        }
      }
    }
  }

  const totalPenalty = penalties.reduce((sum, p) => sum + p.deltaPct, 0);
  const totalBonus = bonuses.reduce((sum, b) => sum + b.deltaPct, 0);

  const calculatedConfidence = Math.max(32, Math.min(88, Math.round(base - totalPenalty + totalBonus)));

  let qualityTier: "A+" | "A" | "B" | "C" | "High Risk";
  let qualityScore: number;

  if (calculatedConfidence >= 74) {
    qualityTier = "A+";
    qualityScore = Number((8.8 + (calculatedConfidence - 74) * 0.08).toFixed(1));
  } else if (calculatedConfidence >= 66) {
    qualityTier = "A";
    qualityScore = Number((7.8 + (calculatedConfidence - 66) * 0.1).toFixed(1));
  } else if (calculatedConfidence >= 55) {
    qualityTier = "B";
    qualityScore = Number((6.5 + (calculatedConfidence - 55) * 0.1).toFixed(1));
  } else if (calculatedConfidence >= 44) {
    qualityTier = "C";
    qualityScore = Number((5.0 + (calculatedConfidence - 44) * 0.12).toFixed(1));
  } else {
    qualityTier = "High Risk";
    qualityScore = Number(Math.max(2.5, 4.0 - (44 - calculatedConfidence) * 0.1).toFixed(1));
  }

  const isHighRisk = calculatedConfidence < 58 || penalties.length >= 2;

  let decision: "TRADE" | "NO_TRADE" | "WAIT_FOR_CONFIRMATION" = "TRADE";
  let rejectionReason: string | undefined = undefined;

  if (calculatedConfidence < 48 || totalPenalty >= 22) {
    decision = "NO_TRADE";
    rejectionReason = `Математичне очікування від'ємне (впевненість ${calculatedConfidence}%). Критичний ризик пастки або розвороту: ${penalties.map(p => p.reason).join("; ")}.`;
  } else if (calculatedConfidence < 58 || penalties.length >= 2 || losses >= 1) {
    decision = "WAIT_FOR_CONFIRMATION";
    rejectionReason = `Підвищена невизначеність структури (впевненість ${calculatedConfidence}%). Рекомендовано дочекатись додаткового свічкового підтвердження.`;
  }

  let learningContext = "Vexqora Memory: параметри в нормі.";
  if (penalties.length > 0) {
    learningContext = `Евристична адаптація ризику: Впевненість знижено на -${totalPenalty}% через ${penalties.map(p => p.reason).join("; ")}.`;
  } else if (bonuses.length > 0) {
    learningContext = `Евристична адаптація ризику: Підвищена стабільність сетапу (+${totalBonus}%).`;
  }

  return {
    confidencePct: calculatedConfidence,
    qualityScore,
    qualityTier,
    penalties,
    bonuses,
    learningContext,
    isHighRisk,
    decision,
    rejectionReason,
    provenance: "heuristic",
    calibratedProbability: null
  };
}
