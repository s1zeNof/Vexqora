import Link from "next/link";
import type { TradeRow } from "@crypto-bot/shared";
import { formatCryptoPrice } from "../../../lib/format";
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

export default async function PositionsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: rawActive } = await supabase.from("exchange_accounts").select("id, label, environment, paper_balance").eq("is_active", true).limit(1).maybeSingle();
  const active: ActiveAccount | null = rawActive ? { id: String(rawActive.id), label: String(rawActive.label), environment: String(rawActive.environment) } : null;

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [tradesRes, todayRes, weekRes, riskRes] = active ? await Promise.all([
    supabase.from("trades").select("*").eq("account_id", active.id).eq("status", "active").order("opened_at", { ascending: false }),
    supabase.from("trades").select("realized_pnl").eq("account_id", active.id).gte("closed_at", dayStart.toISOString()),
    supabase.from("trades").select("realized_pnl").eq("account_id", active.id).gte("closed_at", weekStart).eq("status", "closed"),
    supabase.from("risk_settings").select("risk_per_trade_pct, max_leverage, max_open_positions, max_daily_loss_pct, kill_switch").eq("account_id", active.id).maybeSingle()
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: null }];

  const trades = (tradesRes.data ?? []) as TradeRow[];
  const todayPnl = (todayRes.data ?? []).reduce((sum: number, row: { realized_pnl: unknown }) => sum + Number(row.realized_pnl ?? 0), 0);
  const weekly = weekRes.data ?? [];
  const winRate = weekly.length ? Math.round(weekly.filter((row: { realized_pnl: unknown }) => Number(row.realized_pnl ?? 0) > 0).length / weekly.length * 100) : null;
  const maxDailyLoss = Number(riskRes.data?.max_daily_loss_pct ?? 5);

  const uniqueSymbols = Array.from(new Set(trades.map((t) => t.symbol)));
  const prices = await getMarketPrices(uniqueSymbols);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", width: "100%" }}>
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
          <strong>{trades.length}</strong>
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
          <h1 style={{ margin: 0, font: "700 24px Inter, sans-serif" }}>Positions</h1>
          <p className="lb" style={{ marginTop: "4px" }}>
            Real-time open perpetual contracts with exchange-hosted stop protection.
          </p>
        </div>
        {active && (
          <form action={closeAllPositions}>
            <input type="hidden" name="accountId" value={active.id} />
            <button
              type="submit"
              className="bt dn"
              disabled={!trades.length}
            >
              Close all positions
            </button>
          </form>
        )}
      </div>

      {/* Dense OKX Table */}
      <div className="cd" style={{ overflow: "hidden" }}>
        <table className="dt-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th>Size</th>
              <th>Entry Price</th>
              <th>Mark Price</th>
              <th>Stop Loss</th>
              <th>Trailing</th>
              <th>Unrealized PnL</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {trades.length > 0 ? (
              trades.map((trade) => {
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
                    <td>{trade.qty}</td>
                    <td>{trade.entry_avg ? formatCryptoPrice(Number(trade.entry_avg)) : "—"}</td>
                    <td>{markPrice !== null ? formatCryptoPrice(markPrice) : "—"}</td>
                    <td style={{ color: "#FF5A6E" }}>{trade.sl ? formatCryptoPrice(Number(trade.sl)) : "—"}</td>
                    <td style={{ color: "#F5C451" }}>{trade.trailing_stop ? "Active" : "—"}</td>
                    <td style={{ color: pnlDisplay === "—" ? "#9A9A9A" : isProfit ? "#42F5B9" : "#FF5A6E" }}>
                      {pnlDisplay}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <Link
                          href={`/dashboard/signal/${trade.symbol}`}
                          className="bt sm"
                        >
                          Chart
                        </Link>
                        <form action={closeTradePosition}>
                          <input type="hidden" name="tradeId" value={trade.id} />
                          <input type="hidden" name="qtyPct" value="50" />
                          <button type="submit" className="bt sm">
                            50%
                          </button>
                        </form>
                        <form action={closeTradePosition}>
                          <input type="hidden" name="tradeId" value={trade.id} />
                          <input type="hidden" name="qtyPct" value="100" />
                          <button type="submit" className="bt dn sm">
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
                <td colSpan={9} style={{ textAlign: "center", padding: "48px 16px", color: "#9A9A9A" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                    <VexqoraLogo size={32} />
                    <p style={{ fontSize: "15px", fontWeight: 600, color: "#FFFFFF" }}>No active open positions</p>
                    <p className="lb">
                      Executed signals will display live telemetry and instant close triggers here.
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
