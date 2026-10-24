"""
Vexqora Real Machine Learning — Feature Engineering Engine
Inspired by FreqAI & Institutional Quantitative Research.
Computes multi-horizon technical, momentum, volatility, and candlestick micro-structure features.
"""

from typing import List, Dict, Any
import math

def calculate_ema(values: List[float], period: int) -> List[float]:
    if not values:
        return []
    alpha = 2.0 / (period + 1)
    ema = [values[0]]
    for i in range(1, len(values)):
        val = alpha * values[i] + (1 - alpha) * ema[-1]
        ema.append(val)
    return ema

def calculate_sma(values: List[float], period: int) -> List[float]:
    result = []
    for i in range(len(values)):
        if i < period - 1:
            result.append(sum(values[:i + 1]) / (i + 1))
        else:
            window = values[i - period + 1:i + 1]
            result.append(sum(window) / period)
    return result

def calculate_rsi(closes: List[float], period: int = 14) -> List[float]:
    if len(closes) < 2:
        return [50.0] * len(closes)
    
    gains = []
    losses = []
    for i in range(1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gains.append(max(0.0, delta))
        losses.append(max(0.0, -delta))
    
    rsi = [50.0]
    if len(gains) < period:
        for _ in range(len(gains)):
            rsi.append(50.0)
        return rsi

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    rs = avg_gain / (avg_loss + 1e-9)
    rsi.append(100.0 - (100.0 / (1.0 + rs)))

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        rs = avg_gain / (avg_loss + 1e-9)
        rsi.append(100.0 - (100.0 / (1.0 + rs)))

    return rsi

def calculate_atr(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> List[float]:
    if not highs:
        return []
    tr = [highs[0] - lows[0]]
    for i in range(1, len(highs)):
        h_l = highs[i] - lows[i]
        h_pc = abs(highs[i] - closes[i - 1])
        l_pc = abs(lows[i] - closes[i - 1])
        tr.append(max(h_l, h_pc, l_pc))
    return calculate_ema(tr, period)

def extract_candle_features(candles: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    """
    Given a chronological list of candles:
    [{"time": ts, "open": o, "high": h, "low": l, "close": c, "volume": v}, ...]
    Computes pure normalized features for each bar without lookahead bias.
    """
    n = len(candles)
    if n == 0:
        return []

    opens = [float(c["open"]) for c in candles]
    highs = [float(c["high"]) for c in candles]
    lows = [float(c["low"]) for c in candles]
    closes = [float(c["close"]) for c in candles]
    volumes = [float(c.get("volume", 0)) for c in candles]
    times = [int(c.get("time", 0)) for c in candles]

    # Moving averages
    ema_9 = calculate_ema(closes, 9)
    ema_21 = calculate_ema(closes, 21)
    ema_50 = calculate_ema(closes, 50)
    ema_200 = calculate_ema(closes, 200)

    # Momentum
    rsi_14 = calculate_rsi(closes, 14)
    vol_sma_20 = calculate_sma(volumes, 20)
    atr_14 = calculate_atr(highs, lows, closes, 14)

    # MACD
    ema_12 = calculate_ema(closes, 12)
    ema_26 = calculate_ema(closes, 26)
    macd_line = [ema_12[i] - ema_26[i] for i in range(n)]
    macd_signal = calculate_ema(macd_line, 9)
    macd_hist = [macd_line[i] - macd_signal[i] for i in range(n)]

    # Bollinger Bands 20
    sma_20 = calculate_sma(closes, 20)
    
    feature_rows = []
    for i in range(n):
        c = closes[i]
        o = opens[i]
        h = highs[i]
        l = lows[i]
        v = volumes[i]
        hl_range = max(h - l, 1e-8)

        # Bollinger std
        start_idx = max(0, i - 19)
        win = closes[start_idx:i + 1]
        mean_c = sma_20[i]
        std_c = math.sqrt(sum((x - mean_c) ** 2 for x in win) / len(win)) if len(win) > 1 else 1e-4
        bb_upper = mean_c + 2.0 * std_c
        bb_lower = mean_c - 2.0 * std_c
        bb_pct = (c - bb_lower) / max(bb_upper - bb_lower, 1e-8)
        bb_bandwidth = (bb_upper - bb_lower) / max(mean_c, 1e-8)

        # Returns over horizons
        ret_1 = math.log(c / closes[i - 1]) if i >= 1 else 0.0
        ret_5 = math.log(c / closes[i - 5]) if i >= 5 else 0.0
        ret_15 = math.log(c / closes[i - 15]) if i >= 15 else 0.0

        # Cyclics
        timestamp_sec = times[i] / 1000.0 if times[i] > 1e11 else float(times[i])
        hour_utc = (timestamp_sec // 3600) % 24
        hour_sin = math.sin(2.0 * math.pi * hour_utc / 24.0)
        hour_cos = math.cos(2.0 * math.pi * hour_utc / 24.0)

        # Candlestick anatomy
        body = abs(c - o)
        body_ratio = body / hl_range
        upper_wick = (h - max(o, c)) / hl_range
        lower_wick = (min(o, c) - l) / hl_range

        row = {
            "ret_1": round(ret_1 * 100, 4),
            "ret_5": round(ret_5 * 100, 4),
            "ret_15": round(ret_15 * 100, 4),
            "rsi_14": round(rsi_14[i], 2),
            "ema_9_diff_pct": round(((c - ema_9[i]) / max(ema_9[i], 1e-8)) * 100, 4),
            "ema_21_diff_pct": round(((c - ema_21[i]) / max(ema_21[i], 1e-8)) * 100, 4),
            "ema_50_diff_pct": round(((c - ema_50[i]) / max(ema_50[i], 1e-8)) * 100, 4),
            "ema_200_diff_pct": round(((c - ema_200[i]) / max(ema_200[i], 1e-8)) * 100, 4),
            "macd_hist_norm": round((macd_hist[i] / max(c, 1e-8)) * 100, 4),
            "bb_pct": round(bb_pct, 4),
            "bb_bandwidth": round(bb_bandwidth * 100, 4),
            "atr_pct": round((atr_14[i] / max(c, 1e-8)) * 100, 4),
            "volume_ratio": round(v / max(vol_sma_20[i], 1e-8), 3),
            "candle_body_ratio": round(body_ratio, 3),
            "candle_upper_wick": round(upper_wick, 3),
            "candle_lower_wick": round(lower_wick, 3),
            "hour_sin": round(hour_sin, 4),
            "hour_cos": round(hour_cos, 4)
        }
        feature_rows.append(row)

    return feature_rows

FEATURE_NAMES = [
    "ret_1", "ret_5", "ret_15", "rsi_14",
    "ema_9_diff_pct", "ema_21_diff_pct", "ema_50_diff_pct", "ema_200_diff_pct",
    "macd_hist_norm", "bb_pct", "bb_bandwidth", "atr_pct",
    "volume_ratio", "candle_body_ratio", "candle_upper_wick", "candle_lower_wick",
    "hour_sin", "hour_cos"
]
