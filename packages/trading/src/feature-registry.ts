import type { Kline } from "@crypto-bot/shared";

export function calculateEMA(values: number[], period: number): number[] {
  if (!values || values.length === 0) return [];
  const alpha = 2.0 / (period + 1);
  const ema: number[] = [values[0]!];
  for (let i = 1; i < values.length; i++) {
    const val = alpha * values[i]! + (1 - alpha) * ema[i - 1]!;
    ema.push(val);
  }
  return ema;
}

export function calculateSMA(values: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      const window = values.slice(0, i + 1);
      result.push(window.reduce((a, b) => a + b, 0) / (i + 1));
    } else {
      const window = values.slice(i - period + 1, i + 1);
      result.push(window.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

/**
 * Standard Wilder's Smoothed RSI(14).
 * Strictly guarantees output array length === closes.length.
 * Warm-up bars prior to index 14 are populated with 50.0.
 */
export function calculateRSI(closes: number[], period: number = 14): number[] {
  const n = closes.length;
  if (n === 0) return [];
  if (n <= period) return new Array<number>(n).fill(50.0);

  const rsi: number[] = new Array<number>(n).fill(50.0);

  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i <= period; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    gains.push(Math.max(0, diff));
    losses.push(Math.max(0, -diff));
  }

  let avgGain = gains.reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.reduce((a, b) => a + b, 0) / period;

  if (avgLoss === 0) {
    rsi[period] = avgGain > 0 ? 100.0 : 50.0;
  } else {
    const rs = avgGain / avgLoss;
    rsi[period] = 100.0 - 100.0 / (1.0 + rs);
  }

  // Wilder's exponential smoothing
  for (let i = period + 1; i < n; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    const gain = Math.max(0, diff);
    const loss = Math.max(0, -diff);

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      rsi[i] = avgGain > 0 ? 100.0 : 50.0;
    } else {
      const rs = avgGain / avgLoss;
      rsi[i] = 100.0 - 100.0 / (1.0 + rs);
    }
  }

  return rsi;
}

export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number[] {
  if (!highs || highs.length === 0) return [];
  const tr: number[] = [highs[0]! - lows[0]!];
  for (let i = 1; i < highs.length; i++) {
    const hL = highs[i]! - lows[i]!;
    const hPc = Math.abs(highs[i]! - closes[i - 1]!);
    const lPc = Math.abs(lows[i]! - closes[i - 1]!);
    tr.push(Math.max(hL, hPc, lPc));
  }
  return calculateEMA(tr, period);
}

export function calculateMACD(closes: number[]): {
  macdLine: number[];
  signalLine: number[];
  histogram: number[];
} {
  const n = closes.length;
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine: number[] = [];
  for (let i = 0; i < n; i++) {
    macdLine.push((ema12[i] ?? 0) - (ema26[i] ?? 0));
  }
  const signalLine = calculateEMA(macdLine, 9);
  const histogram: number[] = [];
  for (let i = 0; i < n; i++) {
    histogram.push((macdLine[i] ?? 0) - (signalLine[i] ?? 0));
  }
  return { macdLine, signalLine, histogram };
}

export function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  stdDevMultiplier: number = 2.0
): {
  upper: number[];
  middle: number[];
  lower: number[];
  bandwidth: number[];
  percentB: number[];
} {
  const sma = calculateSMA(closes, period);
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];
  const bandwidth: number[] = [];
  const percentB: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    const startIdx = Math.max(0, i - period + 1);
    const win = closes.slice(startIdx, i + 1);
    const mean = sma[i] ?? closes[i]!;
    const variance = win.reduce((sum, x) => sum + (x - mean) ** 2, 0) / Math.max(1, win.length);
    const std = Math.sqrt(variance);

    const up = mean + stdDevMultiplier * std;
    const lo = mean - stdDevMultiplier * std;
    const bw = (up - lo) / Math.max(mean, 1e-8);
    const pctB = (closes[i]! - lo) / Math.max(up - lo, 1e-8);

    upper.push(up);
    middle.push(mean);
    lower.push(lo);
    bandwidth.push(bw);
    percentB.push(pctB);
  }

  return { upper, middle, lower, bandwidth, percentB };
}

export const CANONICAL_FEATURE_NAMES = [
  "ret_1",
  "ret_5",
  "ret_15",
  "rsi_14",
  "ema_9_diff_pct",
  "ema_21_diff_pct",
  "ema_50_diff_pct",
  "ema_200_diff_pct",
  "macd_hist_norm",
  "bb_pct",
  "bb_bandwidth",
  "atr_pct",
  "volume_ratio",
  "candle_body_ratio",
  "candle_upper_wick",
  "candle_lower_wick",
  "hour_sin",
  "hour_cos"
] as const;

export type CanonicalFeatureName = (typeof CANONICAL_FEATURE_NAMES)[number];

/**
 * Extracts canonical features from klines in TypeScript.
 * Parity-tested with packages/ml-engine/features.py.
 */
export function extractCanonicalFeatures(
  candles: Kline[]
): Array<Record<CanonicalFeatureName, number>> {
  const n = candles.length;
  if (n === 0) return [];

  const opens = candles.map((c) => c.open);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const times = candles.map((c) => c.time);

  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);

  const rsi14 = calculateRSI(closes, 14);
  const volSma20 = calculateSMA(volumes, 20);
  const atr14 = calculateATR(highs, lows, closes, 14);
  const { histogram: macdHist } = calculateMACD(closes);
  const { percentB: bbPct, bandwidth: bbBandwidth } = calculateBollingerBands(closes, 20);

  const rows: Array<Record<CanonicalFeatureName, number>> = [];

  for (let i = 0; i < n; i++) {
    const c = closes[i]!;
    const o = opens[i]!;
    const h = highs[i]!;
    const l = lows[i]!;
    const v = volumes[i]!;
    const hlRange = Math.max(h - l, 1e-8);

    const ret1 = i >= 1 && closes[i - 1]! > 0 ? Math.log(c / closes[i - 1]!) : 0;
    const ret5 = i >= 5 && closes[i - 5]! > 0 ? Math.log(c / closes[i - 5]!) : 0;
    const ret15 = i >= 15 && closes[i - 15]! > 0 ? Math.log(c / closes[i - 15]!) : 0;

    const t = times[i] ?? 0;
    const timestampSec = t > 1e11 ? t / 1000 : t;
    const hourUtc = Math.floor(timestampSec / 3600) % 24;
    const hourSin = Math.sin((2.0 * Math.PI * hourUtc) / 24.0);
    const hourCos = Math.cos((2.0 * Math.PI * hourUtc) / 24.0);

    const body = Math.abs(c - o);
    const bodyRatio = body / hlRange;
    const upperWick = (h - Math.max(o, c)) / hlRange;
    const lowerWick = (Math.min(o, c) - l) / hlRange;

    rows.push({
      ret_1: Number((ret1 * 100).toFixed(4)),
      ret_5: Number((ret5 * 100).toFixed(4)),
      ret_15: Number((ret15 * 100).toFixed(4)),
      rsi_14: Number(rsi14[i]!.toFixed(2)),
      ema_9_diff_pct: Number((((c - ema9[i]!) / Math.max(ema9[i]!, 1e-8)) * 100).toFixed(4)),
      ema_21_diff_pct: Number((((c - ema21[i]!) / Math.max(ema21[i]!, 1e-8)) * 100).toFixed(4)),
      ema_50_diff_pct: Number((((c - ema50[i]!) / Math.max(ema50[i]!, 1e-8)) * 100).toFixed(4)),
      ema_200_diff_pct: Number((((c - ema200[i]!) / Math.max(ema200[i]!, 1e-8)) * 100).toFixed(4)),
      macd_hist_norm: Number(((macdHist[i]! / Math.max(c, 1e-8)) * 100).toFixed(4)),
      bb_pct: Number(bbPct[i]!.toFixed(4)),
      bb_bandwidth: Number((bbBandwidth[i]! * 100).toFixed(4)),
      atr_pct: Number(((atr14[i]! / Math.max(c, 1e-8)) * 100).toFixed(4)),
      volume_ratio: Number((v / Math.max(volSma20[i]!, 1e-8)).toFixed(3)),
      candle_body_ratio: Number(bodyRatio.toFixed(3)),
      candle_upper_wick: Number(upperWick.toFixed(3)),
      candle_lower_wick: Number(lowerWick.toFixed(3)),
      hour_sin: Number(hourSin.toFixed(4)),
      hour_cos: Number(hourCos.toFixed(4))
    });
  }

  return rows;
}
