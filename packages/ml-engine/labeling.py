"""
Vexqora Real Machine Learning — Triple-Barrier Target Labeling
Inspired by Marcos López de Prado: Advances in Financial Machine Learning.
Labels historical entries based on whether Take Profit is reached before Stop Loss,
incorporating Bybit taker execution fees (0.055% * 2 = 0.11%).
"""

from typing import List, Dict, Any, Tuple

BYBIT_TAKER_ROUNDTRIP_FEE = 0.0011 # 0.055% open + 0.055% close = 0.11%

def triple_barrier_labeling(
    candles: List[Dict[str, Any]],
    side: str = "long",
    tp_pct: float = 0.025,  # 2.5% TP
    sl_pct: float = 0.015,  # 1.5% SL
    max_horizon_bars: int = 24 # 6 hours on 15m candles
) -> List[Tuple[int, float]]:
    """
    Returns list of (label, net_return_pct) for each bar.
    Label 1 = Take Profit hit first (Profitable trade).
    Label 0 = Stop Loss hit first or time expired in loss/breakeven.
    """
    n = len(candles)
    results = []

    for i in range(n):
        # We need at least 1 future bar to evaluate
        if i >= n - 1:
            results.append((0, 0.0))
            continue

        entry_price = float(candles[i]["close"])
        if entry_price <= 0:
            results.append((0, 0.0))
            continue

        horizon_end = min(n, i + 1 + max_horizon_bars)
        label = 0
        net_return = 0.0
        resolved = False

        if side.lower() == "long":
            upper_tp = entry_price * (1.0 + tp_pct)
            lower_sl = entry_price * (1.0 - sl_pct)

            for future_idx in range(i + 1, horizon_end):
                bar = candles[future_idx]
                h = float(bar["high"])
                l = float(bar["low"])

                # Conservative risk rule: if both touched in same bar, assume SL triggered
                if l <= lower_sl and h >= upper_tp:
                    label = 0
                    net_return = -sl_pct - BYBIT_TAKER_ROUNDTRIP_FEE
                    resolved = True
                    break
                elif l <= lower_sl:
                    label = 0
                    net_return = -sl_pct - BYBIT_TAKER_ROUNDTRIP_FEE
                    resolved = True
                    break
                elif h >= upper_tp:
                    label = 1
                    net_return = tp_pct - BYBIT_TAKER_ROUNDTRIP_FEE
                    resolved = True
                    break

            if not resolved:
                # Horizon expired: evaluate net return at final bar
                exit_price = float(candles[horizon_end - 1]["close"])
                gross_ret = (exit_price - entry_price) / entry_price
                net_ret = gross_ret - BYBIT_TAKER_ROUNDTRIP_FEE
                label = 1 if net_ret > 0.005 else 0
                net_return = net_ret

        else: # SHORT
            upper_tp = entry_price * (1.0 - tp_pct)
            lower_sl = entry_price * (1.0 + sl_pct)

            for future_idx in range(i + 1, horizon_end):
                bar = candles[future_idx]
                h = float(bar["high"])
                l = float(bar["low"])

                if h >= lower_sl and l <= upper_tp:
                    label = 0
                    net_return = -sl_pct - BYBIT_TAKER_ROUNDTRIP_FEE
                    resolved = True
                    break
                elif h >= lower_sl:
                    label = 0
                    net_return = -sl_pct - BYBIT_TAKER_ROUNDTRIP_FEE
                    resolved = True
                    break
                elif l <= upper_tp:
                    label = 1
                    net_return = tp_pct - BYBIT_TAKER_ROUNDTRIP_FEE
                    resolved = True
                    break

            if not resolved:
                exit_price = float(candles[horizon_end - 1]["close"])
                gross_ret = (entry_price - exit_price) / entry_price
                net_ret = gross_ret - BYBIT_TAKER_ROUNDTRIP_FEE
                label = 1 if net_ret > 0.005 else 0
                net_return = net_ret

        results.append((label, round(net_return * 100, 3)))

    return results
