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
  const { data: rawActive } = await supabase.from("exchange_accounts").select("id, label, environment").eq("is_active", true).limit(1).maybeSingle();
  const active: ActiveAccount | null = rawActive ? { id: String(rawActive.id), label: String(rawActive.label), environment: String(rawActive.environment) } : null;
  const trades = (active
    ? (await supabase.from("trades").select("*").eq("account_id", active.id).eq("status", "active").order("opened_at", { ascending: false })).data
    : []) as TradeRow[] | null;

  const uniqueSymbols = Array.from(new Set((trades ?? []).map((t) => t.symbol)));
  const prices = await getMarketPrices(uniqueSymbols);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <span className="eyebrow">Realtime Execution</span>
          <h1 style={{ marginTop: "6px" }}>Open Positions</h1>
          <p className="lead">Open positions for the active paper or exchange-backed workspace.</p>
        </div>
        {active && (
          <form action={closeAllPositions}>
            <input type="hidden" name="accountId" value={active.id} />
            <button type="submit" className="button danger" disabled={!trades?.length}>Close all positions</button>
          </form>
        )}
      </div>

      <div className="table-wrap">
        <table className="data-table">
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
            {trades && trades.length > 0 ? (
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
                    <td><strong>{trade.symbol}</strong></td>
                    <td><span className={`badge ${trade.side}`}>{trade.side} {trade.leverage}x</span></td>
                    <td className="mono">{trade.qty}</td>
                    <td className="mono">{trade.entry_avg ? formatCryptoPrice(Number(trade.entry_avg)) : "—"}</td>
                    <td className="mono">{markPrice !== null ? formatCryptoPrice(markPrice) : "—"}</td>
                    <td className="mono negative">{trade.sl ? formatCryptoPrice(Number(trade.sl)) : "—"}</td>
                    <td className="mono warning">{trade.trailing_stop ? "configured" : "—"}</td>
                    <td className={`mono ${pnlDisplay === "—" ? "" : isProfit ? "positive" : "negative"}`}>
                      {pnlDisplay}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <form action={closeTradePosition}>
                          <input type="hidden" name="tradeId" value={trade.id} />
                          <input type="hidden" name="qtyPct" value="50" />
                          <button type="submit" className="button secondary" style={{ minHeight: "32px", padding: "0 10px", fontSize: "12px" }}>
                            Close 50%
                          </button>
                        </form>
                        <form action={closeTradePosition}>
                          <input type="hidden" name="tradeId" value={trade.id} />
                          <input type="hidden" name="qtyPct" value="100" />
                          <button type="submit" className="button danger" style={{ minHeight: "32px", padding: "0 10px", fontSize: "12px" }}>
                            Market Close
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", padding: "48px 16px", color: "var(--muted)" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                    <VexqoraLogo size={36} />
                    <p style={{ fontSize: "15px", fontWeight: "600", color: "var(--text)" }}>No active open positions</p>
                    <p style={{ fontSize: "13px" }}>Executed trades will display live position telemetry, trailing state and instant close triggers here.</p>
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

