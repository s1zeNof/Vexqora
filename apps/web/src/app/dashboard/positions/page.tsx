import Link from "next/link";
import type { TradeRow } from "@crypto-bot/shared";
import { formatCryptoPrice } from "../../../lib/format";
import { formatTimeAgo } from "../../../lib/date";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { VexqoraLogo } from "../../../components/logo";
import { closeAllPositions, closeTradePosition } from "../actions";

async function getMarketPrices(symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  const prices: Record<string, number> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${encodeURIComponent(symbol.toUpperCase())}`, {
          next: { revalidate: 2 }
        });
        if (res.ok) {
          const data = (await res.json()) as { result?: { list?: Array<{ lastPrice: string }> } };
          const last = data.result?.list?.[0]?.lastPrice;
          if (last) prices[symbol.toUpperCase()] = Number(last);
        }
      } catch {
        // ignore
      }
    })
  );
  return prices;
}

interface ActiveAccount {
  id: string;
  label: string;
  environment: string;
}

interface PositionsPageProps {
  searchParams?: Promise<{ tab?: string }>;
}

export default async function PositionsPage({ searchParams }: PositionsPageProps) {
  const query = (await searchParams) ?? {};
  const currentTab = query.tab === "archive" ? "archive" : "active";

  const supabase = await createSupabaseServerClient();
  const { data: rawActive } = await supabase
    .from("exchange_accounts")
    .select("id, label, environment, paper_balance")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const active: ActiveAccount | null = rawActive
    ? { id: String(rawActive.id), label: String(rawActive.label), environment: String(rawActive.environment) }
    : null;

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Query open positions, closed positions, daily PnL, weekly win rate, and risk
  const [openTradesRes, closedTradesRes, todayRes, weekRes, riskRes] = active
    ? await Promise.all([
        supabase
          .from("trades")
          .select("*")
          .eq("account_id", active.id)
          .in("status", ["active", "entry_open"])
          .order("opened_at", { ascending: false, nullsFirst: false }),
        supabase
          .from("trades")
          .select("*")
          .eq("account_id", active.id)
          .eq("status", "closed")
          .order("closed_at", { ascending: false, nullsFirst: false })
          .limit(50),
        supabase
          .from("trades")
          .select("realized_pnl")
          .eq("account_id", active.id)
          .gte("closed_at", dayStart.toISOString()),
        supabase
          .from("trades")
          .select("realized_pnl")
          .eq("account_id", active.id)
          .gte("closed_at", weekStart)
          .eq("status", "closed"),
        supabase
          .from("risk_settings")
          .select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, kill_switch")
          .eq("account_id", active.id)
          .maybeSingle()
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: null }];

  const openTrades = (openTradesRes.data ?? []) as TradeRow[];
  const closedTrades = (closedTradesRes.data ?? []) as TradeRow[];

  // Auto-heal any open trades with missing opened_at
  if (active && openTrades.some((t) => !t.opened_at)) {
    const missingIds = openTrades.filter((t) => !t.opened_at).map((t) => t.id);
    await supabase.from("trades").update({ opened_at: new Date().toISOString(), status: "active" }).in("id", missingIds);
  }

  const todayPnl = (todayRes.data ?? []).reduce(
    (sum: number, row: { realized_pnl: unknown }) => sum + Number(row.realized_pnl ?? 0),
    0
  );
  const weekly = weekRes.data ?? [];
  const winRate = weekly.length
    ? Math.round(
        (weekly.filter((row: { realized_pnl: unknown }) => Number(row.realized_pnl ?? 0) > 0).length / weekly.length) * 100
      )
    : null;
  const maxDailyLoss = Number(riskRes.data?.max_daily_loss_pct ?? 5);

  const uniqueSymbols = Array.from(new Set(openTrades.map((t) => t.symbol)));
  const prices = await getMarketPrices(uniqueSymbols);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", width: "100%", maxWidth: "1232px", margin: "0 auto", paddingBottom: "40px" }}>
      {/* Compact KPI Metric Strip */}
      <section className="metric-grid">
        <article className="metric">
          <span className="lb">Active Workspace</span>
          <strong>{active?.label ?? "Paper · Vexqora"}</strong>
          <small>{active?.environment?.toUpperCase() ?? "DEMO"}</small>
        </article>
        <article className="metric">
          <span className="lb">Today Realized PnL</span>
          <strong style={{ color: todayPnl >= 0 ? "#42F5B9" : "#FF5A6E" }}>
            {todayPnl >= 0 ? "+" : ""}${todayPnl.toFixed(2)}
          </strong>
          <small>Daily limit: {maxDailyLoss}%</small>
        </article>
        <article className="metric">
          <span className="lb">Open Positions</span>
          <strong>{openTrades.length}</strong>
          <small>Max: {riskRes.data?.max_open_positions ?? 3} concurrent</small>
        </article>
        <article className="metric">
          <span className="lb">Win Rate · 7D</span>
          <strong style={{ color: winRate && winRate >= 50 ? "#42F5B9" : "#FFFFFF" }}>
            {winRate === null ? "—" : `${winRate}%`}
          </strong>
          <small>{weekly.length} trades settled</small>
        </article>
      </section>

      {/* Page Title & Close All */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ margin: 0, font: "700 24px Inter, sans-serif" }}>Позиції</h1>
          <p className="lb" style={{ marginTop: "4px" }}>
            Активні позиції за останні 48 годин та безстроковий архів закритих угод.
          </p>
        </div>
        {active && openTrades.length > 0 && currentTab === "active" && (
          <form action={closeAllPositions}>
            <input type="hidden" name="accountId" value={active.id} />
            <button
              type="submit"
              className="bt dn"
              disabled={!openTrades.length}
            >
              Закрити всі позиції
            </button>
          </form>
        )}
      </div>

      {/* Tabs: Active vs Archive */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid #262626", paddingBottom: "12px" }}>
        <Link
          href="/dashboard/positions?tab=active"
          className={`tab ${currentTab === "active" ? "on" : ""}`}
          style={{ padding: "8px 16px", fontSize: "14px", fontWeight: 600, textDecoration: "none" }}
        >
          ⚡ Відкриті позиції ({openTrades.length})
        </Link>
        <Link
          href="/dashboard/positions?tab=archive"
          className={`tab ${currentTab === "archive" ? "on" : ""}`}
          style={{ padding: "8px 16px", fontSize: "14px", fontWeight: 600, textDecoration: "none" }}
        >
          📁 Архів закритих угод ({closedTrades.length})
        </Link>
      </div>

      {/* Content for Current Tab */}
      {currentTab === "active" ? (
        /* Active Open Positions Table */
        <div className="cd" style={{ overflow: "hidden" }}>
          <table className="dt-table">
            <thead>
              <tr>
                <th>Символ</th>
                <th>Напрямок</th>
                <th>Розмір</th>
                <th>Вхід (Entry)</th>
                <th>Mark Ціна</th>
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
                  const markPrice = prices[trade.symbol.toUpperCase()] ?? (trade.entry_avg ? Number(trade.entry_avg) : null);
                  const entryPrice = trade.entry_avg ? Number(trade.entry_avg) : 0;
                  const qty = Number(trade.qty) || 0;
                  const leverage = Number(trade.leverage) || 1;
                  const direction = trade.side === "long" ? 1 : -1;

                  let pnlDisplay = "—";
                  let isProfit = true;

                  if (markPrice !== null && entryPrice > 0 && qty > 0) {
                    const diff = markPrice - entryPrice;
                    const unrealizedPnl = diff * qty * direction;
                    const pnlPct = (diff / entryPrice) * leverage * 100 * direction;
                    isProfit = unrealizedPnl >= 0;
                    pnlDisplay = `${isProfit ? "+" : ""}${unrealizedPnl.toFixed(2)} USDT (${isProfit ? "+" : ""}${pnlPct.toFixed(2)}%)`;
                  }

                  return (
                    <tr key={trade.id}>
                      <td>
                        <Link
                          href={`/dashboard/signal/${trade.symbol}`}
                          style={{ fontWeight: 600, color: "#FFFFFF", textDecoration: "underline", textUnderlineOffset: "3px" }}
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
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{trade.entry_avg ? `$${formatCryptoPrice(Number(trade.entry_avg))}` : "—"}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{markPrice !== null ? `$${formatCryptoPrice(markPrice)}` : "—"}</td>
                      <td style={{ color: "#FF5A6E", fontVariantNumeric: "tabular-nums" }}>{trade.sl ? `$${formatCryptoPrice(Number(trade.sl))}` : "—"}</td>
                      <td>
                        {(() => {
                          const trailingObj = trade.trailing_stop as { controlMode?: "auto" | "manual"; activated?: boolean } | null;
                          if (trailingObj?.controlMode === "manual") {
                            return <span className="tg gy" style={{ color: "#FFC24B", border: "1px solid #FFC24B44", fontSize: "11px" }}>👤 Ручний</span>;
                          }
                          if (trailingObj?.activated) {
                            return <span className="tg lg" style={{ fontSize: "11px" }}>⚡ Трейлінг</span>;
                          }
                          if (trade.trailing_stop) {
                            return <span className="tg gy" style={{ color: "#B24BFF", border: "1px solid #7C4DFF44", fontSize: "11px" }}>🤖 Автопілот</span>;
                          }
                          return <span style={{ color: "#9A9A9A" }}>—</span>;
                        })()}
                      </td>
                      <td style={{ color: pnlDisplay === "—" ? "#9A9A9A" : isProfit ? "#42F5B9" : "#FF5A6E", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {pnlDisplay}
                      </td>
                      <td style={{ fontSize: "12px", color: "#9A9A9A" }}>
                        {trade.opened_at ? formatTimeAgo(trade.opened_at) : "Щойно"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px" }}>
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
                      <p style={{ fontSize: "15px", fontWeight: 600, color: "#FFFFFF" }}>Немає активних відкритих позицій</p>
                      <p className="lb">
                        Відкрийте ордер на сторінці сигналу або в Pulse, і він миттєво з'явиться тут.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Archived / Closed Positions Table */
        <div className="cd" style={{ overflow: "hidden" }}>
          <table className="dt-table">
            <thead>
              <tr>
                <th>Символ</th>
                <th>Напрямок</th>
                <th>Розмір</th>
                <th>Ціна входу</th>
                <th>Фінальний PnL</th>
                <th>Причина виходу</th>
                <th>Час відкриття</th>
                <th>Час закриття</th>
                <th>Статус</th>
                <th>Дія</th>
              </tr>
            </thead>
            <tbody>
              {closedTrades.length > 0 ? (
                closedTrades.map((trade) => {
                  const pnl = Number(trade.realized_pnl ?? 0);
                  const isProfit = pnl >= 0;

                  return (
                    <tr key={trade.id}>
                      <td>
                        <Link
                          href={`/dashboard/signal/${trade.symbol}`}
                          style={{ fontWeight: 600, color: "#FFFFFF", textDecoration: "underline", textUnderlineOffset: "3px" }}
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
                          color: isProfit ? "#42F5B9" : "#FF5A6E",
                          fontWeight: 700,
                          fontVariantNumeric: "tabular-nums"
                        }}
                      >
                        {isProfit ? "+" : ""}${pnl.toFixed(2)} USDT
                      </td>
                      <td>
                        <span className={`tg ${trade.exit_reason === "stop_loss" ? "sh" : trade.exit_reason === "take_profit" ? "lg" : "gy"}`}>
                          {trade.exit_reason === "take_profit" ? "Take Profit" :
                            trade.exit_reason === "stop_loss" ? "Stop Loss" :
                              trade.exit_reason === "trailing_stop" ? "Trailing Stop" :
                                trade.exit_reason === "manual" ? "Manual" :
                                  trade.exit_reason === "close_all" ? "Close All" : "Closed"}
                          {trade.exit_price ? ` @ $${formatCryptoPrice(Number(trade.exit_price))}` : ""}
                        </span>
                      </td>
                      <td style={{ fontSize: "12px", color: "#9A9A9A" }}>
                        {trade.opened_at ? formatTimeAgo(trade.opened_at) : "—"}
                      </td>
                      <td style={{ fontSize: "12px", color: "#9A9A9A" }}>
                        {trade.closed_at ? formatTimeAgo(trade.closed_at) : "—"}
                      </td>
                      <td>
                        <span className="tg gy" style={{ color: "#9A9A9A" }}>
                          Closed
                        </span>
                      </td>
                      <td>
                        <Link
                          href={`/dashboard/signal/${trade.symbol}`}
                          className="bt sm"
                        >
                          Аналіз ↗
                        </Link>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", padding: "48px 16px", color: "#9A9A9A" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "32px" }}>📁</span>
                      <p style={{ fontSize: "15px", fontWeight: 600, color: "#FFFFFF" }}>В архіві немає закритих угод</p>
                      <p className="lb">
                        Усі розраховані та закриті угоди безстроково зберігатимуться в цьому архіві.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
