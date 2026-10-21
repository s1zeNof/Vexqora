import type { TradeRow } from "@crypto-bot/shared";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export default async function HistoryPage() {
  const supabase = await createSupabaseServerClient();
  const { data: active } = await supabase.from("exchange_accounts").select("id").eq("is_active", true).limit(1).maybeSingle();
  const closedTrades = (active
    ? (await supabase.from("trades").select("*").eq("account_id", active.id).order("opened_at", { ascending: false }).limit(50)).data
    : []) as TradeRow[] | null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", width: "100%" }}>
      <div>
        <span className="eyebrow">Audit & Performance</span>
        <h1 style={{ marginTop: "6px" }}>Trade & Order History</h1>
        <p className="lead">Historical executions, target hits, stop-loss triggers and realized PnL records.</p>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Symbol</th>
              <th>Side</th>
              <th>Qty</th>
              <th>Avg Entry</th>
              <th>Status</th>
              <th>Realized PnL</th>
            </tr>
          </thead>
          <tbody>
            {closedTrades && closedTrades.length > 0 ? (
              closedTrades.map((trade) => (
                <tr key={trade.id}>
                  <td className="mono" style={{ color: "var(--muted)" }}>{new Date(trade.opened_at || Date.now()).toLocaleString()}</td>
                  <td><strong>{trade.symbol}</strong></td>
                  <td><span className={`badge ${trade.side}`}>{trade.side}</span></td>
                  <td className="mono">{trade.qty}</td>
                  <td className="mono">{trade.entry_avg}</td>
                  <td><span className="badge demo">{trade.status}</span></td>
                  <td className={`mono ${Number(trade.realized_pnl) >= 0 ? "positive" : "negative"}`}>
                    {Number(trade.realized_pnl) >= 0 ? `+$${Number(trade.realized_pnl).toFixed(2)}` : `-$${Math.abs(Number(trade.realized_pnl)).toFixed(2)}`}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "48px 16px", color: "var(--muted)" }}>
                  <p style={{ fontSize: "15px", fontWeight: "600", color: "var(--text)" }}>No past trades recorded</p>
                  <p style={{ fontSize: "13px", marginTop: "4px" }}>Completed trades and closed positions will be archived here.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
