"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TradeRow } from "@crypto-bot/shared";
import { formatCryptoPrice } from "../../../lib/format";
import { formatTimeAgo } from "../../../lib/date";
import { VexqoraLogo } from "../../../components/logo";
import { PnlShareButton } from "./pnl-share-button";
import { closeTradePosition } from "../actions";

interface ActiveAccount {
  id: string;
  label: string;
  environment: string;
}

interface LivePositionsTableProps {
  openTrades: TradeRow[];
  initialPrices: Record<string, number>;
  activeAccount: ActiveAccount | null;
}

interface BybitWsTickerMessage {
  topic?: string;
  data?: {
    symbol?: string;
    lastPrice?: string;
  };
}

interface TickerApiResponse {
  success?: boolean;
  ticker?: {
    lastPrice?: number;
  };
}

export function LivePositionsTable({
  openTrades,
  initialPrices,
  activeAccount
}: LivePositionsTableProps) {
  const router = useRouter();

  // State of live prices for symbols
  const [prices, setPrices] = useState<Record<string, number>>(initialPrices);
  const [priceDirections, setPriceDirections] = useState<Record<string, "up" | "down" | "neutral">>({});
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [, setSecondsTick] = useState<number>(0);

  // Sync initialPrices when props change
  useEffect(() => {
    setPrices((prev) => ({ ...prev, ...initialPrices }));
  }, [initialPrices]);

  // Unique symbols from active trades
  const symbols = useMemo(() => {
    return Array.from(new Set(openTrades.map((t) => t.symbol.toUpperCase()))).filter(Boolean);
  }, [openTrades]);

  // Dynamic seconds tick to re-evaluate formatTimeAgo(trade.opened_at)
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 1. Bybit Public WebSocket multi-ticker stream
  useEffect(() => {
    if (symbols.length === 0) {
      setWsConnected(false);
      return;
    }

    let isMounted = true;
    let ws: WebSocket | null = null;
    let pingInterval: NodeJS.Timeout | null = null;

    try {
      ws = new WebSocket("wss://stream.bybit.com/v5/public/linear");

      ws.onopen = () => {
        if (!isMounted || !ws || ws.readyState !== WebSocket.OPEN) return;
        setWsConnected(true);
        const subArgs = symbols.map((s) => `tickers.${s}`);
        ws.send(JSON.stringify({ op: "subscribe", args: subArgs }));

        pingInterval = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: "ping" }));
          }
        }, 20000);
      };

      ws.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const rawText = typeof event.data === "string" ? event.data : "";
          if (!rawText) return;
          const msg = JSON.parse(rawText) as BybitWsTickerMessage;
          if (msg.topic?.startsWith("tickers.") && msg.data) {
            const sym = String(msg.data.symbol ?? "").toUpperCase();
            const rawPrice = msg.data.lastPrice;
            if (sym && rawPrice) {
              const newPrice = Number(rawPrice);
              if (newPrice > 0) {
                setPrices((prev) => {
                  const oldPrice = prev[sym] ?? newPrice;
                  const dir = newPrice > oldPrice ? "up" : newPrice < oldPrice ? "down" : "neutral";
                  if (dir !== "neutral") {
                    setPriceDirections((d) => ({ ...d, [sym]: dir }));
                    setTimeout(() => {
                      if (isMounted) {
                        setPriceDirections((d) => ({ ...d, [sym]: "neutral" }));
                      }
                    }, 700);
                  }
                  return { ...prev, [sym]: newPrice };
                });
              }
            }
          }
        } catch {
          // ignore malformed ws payload
        }
      };

      ws.onerror = () => {
        if (isMounted) setWsConnected(false);
      };

      ws.onclose = () => {
        if (isMounted) setWsConnected(false);
      };
    } catch {
      setWsConnected(false);
    }

    return () => {
      isMounted = false;
      if (pingInterval) clearInterval(pingInterval);
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
  }, [symbols]);

  // 2. High-frequency 1.5s live polling fallback across active symbols
  useEffect(() => {
    if (symbols.length === 0) return;

    let isMounted = true;
    const interval = setInterval(() => {
      void (async () => {
        try {
          await Promise.all(
            symbols.map(async (sym) => {
              const res = await fetch(`/api/market/ticker?symbol=${encodeURIComponent(sym)}`, {
                cache: "no-store"
              }).catch(() => null);

              if (res && res.ok && isMounted) {
                const data = (await res.json().catch(() => null)) as TickerApiResponse | null;
                const last = Number(data?.ticker?.lastPrice);
                if (last && last > 0) {
                  setPrices((prev) => {
                    const oldPrice = prev[sym] ?? last;
                    if (last !== oldPrice) {
                      const dir = last > oldPrice ? "up" : last < oldPrice ? "down" : "neutral";
                      setPriceDirections((d) => ({ ...d, [sym]: dir }));
                      setTimeout(() => {
                        if (isMounted) setPriceDirections((d) => ({ ...d, [sym]: "neutral" }));
                      }, 700);
                    }
                    return { ...prev, [sym]: last };
                  });
                }
              }
            })
          );
        } catch {
          // ignore network error
        }
      })();
    }, 1500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [symbols]);

  // 3. Automated Paper Matching Engine Ticking for Active Autopilot Positions
  const lastTickTimeRef = useRef<number>(0);
  const isPaperTrading = activeAccount?.environment !== "live";

  useEffect(() => {
    if (!isPaperTrading || openTrades.length === 0) return;

    const now = Date.now();
    if (now - lastTickTimeRef.current < 1500) return;
    lastTickTimeRef.current = now;

    let isMounted = true;

    // Check every active trade with Autopilot enabled
    for (const trade of openTrades) {
      const trailingObj = trade.trailing_stop as { controlMode?: "auto" | "manual" } | null;
      if (trailingObj?.controlMode === "manual") continue;

      const currentPrice = prices[trade.symbol.toUpperCase()];
      if (!currentPrice || currentPrice <= 0) continue;

      const entryPrice = trade.entry_avg ? Number(trade.entry_avg) : 0;
      if (entryPrice > 0 && Math.abs(currentPrice - entryPrice) / entryPrice > 0.12) {
        // Stray anomaly or unverified cross-symbol price: protect position
        continue;
      }

      fetch("/api/trading/paper-tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tradeId: trade.id,
          currentPrice
        })
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { actionsCount?: number; success?: boolean } | null) => {
          if (isMounted && data && (data.actionsCount ?? 0) > 0) {
            // Position was partially closed or fully closed — refresh page
            router.refresh();
          }
        })
        .catch(() => {
          // ignore tick error
        });
    }

    return () => {
      isMounted = false;
    };
  }, [isPaperTrading, openTrades, prices, router]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {/* Live Stream Indicator Bar */}
      {openTrades.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px",
            background: "#0E0B1A",
            border: "1px solid #231B3D",
            borderRadius: "6px",
            fontSize: "12px",
            color: "#A59CC4"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: wsConnected ? "#42F5B9" : "#FFC24B",
                boxShadow: wsConnected ? "0 0 8px #42F5B9" : "0 0 6px #FFC24B",
                display: "inline-block"
              }}
            />
            <span style={{ color: "#FFFFFF", fontWeight: 600 }}>
              {wsConnected ? "Live WebSocket підключено" : "Live Ajax оновлення (1.5s)"}
            </span>
            <span>· {symbols.length} активних {symbols.length === 1 ? "пара" : "пар"}</span>
          </div>

          <div style={{ fontSize: "11px", color: "#B9A2FF" }}>
            ⚡ Live PnL, Mark Ціна та авто-тейкпрофіти активні
          </div>
        </div>
      )}

      {/* Active Positions Table */}
      <div className="cd" style={{ overflow: "hidden" }}>
        <div className="table-responsive">
          <table className="dt-table">
            <thead>
              <tr>
                <th>Символ</th>
                <th>Напрямок</th>
                <th>Розмір</th>
                <th>Вхід (Entry)</th>
                <th>Mark Ціна (Live)</th>
                <th>Stop Loss</th>
                <th>Trailing</th>
                <th>Live PnL</th>
                <th>Час відкриття</th>
                <th>Дії</th>
              </tr>
            </thead>
            <tbody>
              {openTrades.length > 0 ? (
                openTrades.map((trade) => {
                  const sym = trade.symbol.toUpperCase();
                  const markPrice = prices[sym] ?? (trade.entry_avg ? Number(trade.entry_avg) : null);
                  const entryPrice = trade.entry_avg ? Number(trade.entry_avg) : 0;
                  const qty = Number(trade.qty) || 0;
                  const leverage = Number(trade.leverage) || 1;
                  const direction = trade.side === "long" ? 1 : -1;
                  const tickDir = priceDirections[sym] ?? "neutral";

                  let pnlDisplay = "—";
                  let isProfit = true;
                  let unrealizedPnl = 0;
                  let pnlPct = 0;

                  if (markPrice !== null && entryPrice > 0 && qty > 0) {
                    const diff = markPrice - entryPrice;
                    unrealizedPnl = diff * qty * direction;
                    pnlPct = (diff / entryPrice) * leverage * 100 * direction;
                    isProfit = unrealizedPnl >= 0;
                    pnlDisplay = `${isProfit ? "+" : ""}${unrealizedPnl.toFixed(2)} USDT (${isProfit ? "+" : ""}${pnlPct.toFixed(2)}%)`;
                  }

                  return (
                    <tr key={trade.id}>
                      <td>
                        <Link
                          href={`/dashboard/signal/${trade.symbol}`}
                          style={{
                            fontWeight: 600,
                            color: "#FFFFFF",
                            textDecoration: "underline",
                            textUnderlineOffset: "3px"
                          }}
                        >
                          {trade.symbol}
                        </Link>
                      </td>
                      <td>
                        <span className={`tg ${trade.side === "long" ? "lg" : "sh"}`}>
                          {trade.side.toUpperCase()} {trade.leverage}x
                        </span>
                      </td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{trade.qty}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>
                        {trade.entry_avg ? `$${formatCryptoPrice(Number(trade.entry_avg))}` : "—"}
                      </td>
                      <td
                        style={{
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: 600,
                          transition: "color 0.2s, background 0.2s",
                          color:
                            tickDir === "up" ? "#42F5B9" : tickDir === "down" ? "#FF4F9A" : "#FFFFFF"
                        }}
                      >
                        {markPrice !== null ? (
                          <span
                            style={{
                              padding: "2px 6px",
                              borderRadius: "4px",
                              background:
                                tickDir === "up"
                                  ? "rgba(66, 245, 185, 0.15)"
                                  : tickDir === "down"
                                  ? "rgba(255, 79, 154, 0.15)"
                                  : "transparent"
                            }}
                          >
                            ${formatCryptoPrice(markPrice)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ color: "#FF5A6E", fontVariantNumeric: "tabular-nums" }}>
                        {trade.sl ? `$${formatCryptoPrice(Number(trade.sl))}` : "—"}
                      </td>
                      <td>
                        {(() => {
                          const trailingObj = trade.trailing_stop as {
                            controlMode?: "auto" | "manual";
                            activated?: boolean;
                          } | null;
                          if (trailingObj?.controlMode === "manual") {
                            return (
                              <span
                                className="tg gy"
                                style={{ color: "#FFC24B", border: "1px solid #FFC24B44", fontSize: "11px" }}
                              >
                                👤 Ручний
                              </span>
                            );
                          }
                          if (trailingObj?.activated) {
                            return (
                              <span className="tg lg" style={{ fontSize: "11px" }}>
                                ⚡ Трейлінг
                              </span>
                            );
                          }
                          if (trade.trailing_stop) {
                            return (
                              <span
                                className="tg gy"
                                style={{ color: "#B24BFF", border: "1px solid #7C4DFF44", fontSize: "11px" }}
                              >
                                🤖 Автопілот
                              </span>
                            );
                          }
                          return <span style={{ color: "#9A9A9A" }}>—</span>;
                        })()}
                      </td>
                      <td
                        style={{
                          color: pnlDisplay === "—" ? "#9A9A9A" : isProfit ? "#42F5B9" : "#FF5A6E",
                          fontWeight: 700,
                          fontVariantNumeric: "tabular-nums"
                        }}
                      >
                        {pnlDisplay}
                      </td>
                      <td style={{ fontSize: "12px", color: "#9A9A9A" }}>
                        {trade.opened_at ? formatTimeAgo(trade.opened_at) : "Щойно"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                          <PnlShareButton
                            data={{
                              symbol: trade.symbol,
                              side: trade.side,
                              leverage,
                              entryPrice,
                              currentOrExitPrice: markPrice ?? entryPrice,
                              pnlUsdt: unrealizedPnl,
                              pnlPct,
                              isClosed: false,
                              openedAt: trade.opened_at,
                              isPaper: isPaperTrading
                            }}
                          />
                          <Link
                            href={`/dashboard/signal/${trade.symbol}`}
                            className="bt sm"
                            title="Відкрити біржовий термінал та графік"
                          >
                            Графік
                          </Link>
                          <form action={closeTradePosition}>
                            <input type="hidden" name="tradeId" value={trade.id} />
                            <input type="hidden" name="qtyPct" value="50" />
                            <button type="submit" className="bt sm" title="Закрити 50% позиції">
                              50%
                            </button>
                          </form>
                          <form action={closeTradePosition}>
                            <input type="hidden" name="tradeId" value={trade.id} />
                            <input type="hidden" name="qtyPct" value="100" />
                            <button type="submit" className="bt dn sm" title="Ринкове закриття">
                              Close
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", padding: "48px 16px", color: "#9A9A9A" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                      <VexqoraLogo size={32} />
                      <p style={{ fontSize: "15px", fontWeight: 600, color: "#FFFFFF" }}>
                        Немає активних відкритих позицій
                      </p>
                      <p className="lb">
                        Відкрийте ордер на сторінці сигналу або в Pulse, і він миттєво з&apos;явиться тут.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
