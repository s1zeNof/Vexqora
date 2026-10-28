import type { Kline } from "@crypto-bot/shared";

export interface WilderADXResult {
  adx: number;
  plusDi: number;
  minusDi: number;
  dx: number;
  trendStrength: "STRONG_TREND" | "DEVELOPING_TREND" | "WEAK_OR_CONSOLIDATING";
}

/**
 * Computes canonical J. Welles Wilder Jr. Average Directional Index (ADX-14).
 *
 * Implements:
 * 1. True Range: max(H - L, |H - C_prev|, |L - C_prev|)
 * 2. Directional Movement (+DM, -DM)
 * 3. 14-period Wilder smoothing for TR, +DM, -DM
 * 4. Directional Indicators (+DI14, -DI14)
 * 5. Directional Movement Index (DX)
 * 6. 14-period Wilder smoothed ADX
 *
 * Minimum requirement: 28 bars (2 * period) for initial 14-bar DX warmup + 14-bar ADX smoothing.
 */
export function calculateWilderADX(klines: Kline[], period = 14): WilderADXResult | null {
  if (klines.length < period * 2) {
    return null;
  }

  // Bar 0 is reference for Bar 1
  const trList: number[] = [];
  const plusDmList: number[] = [];
  const minusDmList: number[] = [];

  for (let i = 1; i < klines.length; i++) {
    const curr = klines[i]!;
    const prev = klines[i - 1]!;

    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    trList.push(tr);

    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;

    const plusDm = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDm = downMove > upMove && downMove > 0 ? downMove : 0;

    plusDmList.push(plusDm);
    minusDmList.push(minusDm);
  }

  if (trList.length < period * 2 - 1) {
    return null;
  }

  // Step 1: Initial period sum (Wilder's first smoothed value)
  let smoothedTr = 0;
  let smoothedPlusDm = 0;
  let smoothedMinusDm = 0;

  for (let i = 0; i < period; i++) {
    smoothedTr += trList[i]!;
    smoothedPlusDm += plusDmList[i]!;
    smoothedMinusDm += minusDmList[i]!;
  }

  const computeDx = (tr: number, pDm: number, mDm: number): { dx: number; plusDi: number; minusDi: number } => {
    if (tr === 0) return { dx: 0, plusDi: 0, minusDi: 0 };
    const plusDi = (pDm / tr) * 100;
    const minusDi = (mDm / tr) * 100;
    const sumDi = plusDi + minusDi;
    const dx = sumDi === 0 ? 0 : (Math.abs(plusDi - minusDi) / sumDi) * 100;
    return { dx, plusDi, minusDi };
  };

  const dxList: number[] = [];
  let latestDi = computeDx(smoothedTr, smoothedPlusDm, smoothedMinusDm);
  dxList.push(latestDi.dx);

  // Step 2: Wilder smoothing for subsequent bars
  for (let i = period; i < trList.length; i++) {
    smoothedTr = smoothedTr - (smoothedTr / period) + trList[i]!;
    smoothedPlusDm = smoothedPlusDm - (smoothedPlusDm / period) + plusDmList[i]!;
    smoothedMinusDm = smoothedMinusDm - (smoothedMinusDm / period) + minusDmList[i]!;

    latestDi = computeDx(smoothedTr, smoothedPlusDm, smoothedMinusDm);
    dxList.push(latestDi.dx);
  }

  if (dxList.length < period) {
    return null;
  }

  // Step 3: First ADX is the arithmetic mean of the first `period` DX values
  let adx = 0;
  for (let i = 0; i < period; i++) {
    adx += dxList[i]!;
  }
  adx = adx / period;

  // Step 4: Wilder smoothing for subsequent ADX values
  for (let i = period; i < dxList.length; i++) {
    adx = ((adx * (period - 1)) + dxList[i]!) / period;
  }

  const roundedAdx = Number(adx.toFixed(2));
  const roundedPlusDi = Number(latestDi.plusDi.toFixed(2));
  const roundedMinusDi = Number(latestDi.minusDi.toFixed(2));
  const roundedDx = Number(latestDi.dx.toFixed(2));

  let trendStrength: WilderADXResult["trendStrength"] = "DEVELOPING_TREND";
  if (roundedAdx >= 25) {
    trendStrength = "STRONG_TREND";
  } else if (roundedAdx < 20) {
    trendStrength = "WEAK_OR_CONSOLIDATING";
  }

  return {
    adx: roundedAdx,
    plusDi: roundedPlusDi,
    minusDi: roundedMinusDi,
    dx: roundedDx,
    trendStrength
  };
}
