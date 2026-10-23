import Link from "next/link";
import type { TradeRow } from "@crypto-bot/shared";
import { formatCryptoPrice } from "../../../lib/format";
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
        <h1 style={{ margin: 0, font: "700 24px Inter, sans-serif" }}>Trade & Order History</h1>
        <p className="lb" style={{ marginTop: "4px" }}>
          Historical executions, target hits, stop-loss triggers and realized PnL records.
        </p>
      </div>

      <div className="cd" style={{ overflow: "hidden" }}>
        <table className="dt-table">
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
              closedTrades.map((trade) => {
                const pnl = Number(trade.realized_pnl ?? 0);
                return (
                  <tr key={trade.id}>
                    <td style={{ color: "#9A9A9A" }}>
                      {new Date(trade.opened_at || Date.now()).toLocaleString()}
                    </td>
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
                        {trade.side.toUpperCase()}
                      </span>
                    </td>
                    <td>{trade.qty}</td>
                    <td>{trade.entry_avg ? formatCryptoPrice(Number(trade.entry_avg)) : "—"}</td>
                    <td>
                      <span className="tg gy">{trade.status}</span>
                    </td>
                    <td style={{ color: pnl >= 0 ? "#42F5B9" : "#FF5A6E" }}>
                      {pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "48px 16px", color: "#9A9A9A" }}>
                  <p style={{ fontSize: "15px", fontWeight: 600, color: "#FFFFFF" }}>No past trades recorded</p>
                  <p className="lb" style={{ marginTop: "4px" }}>
                    Completed trades and closed positions will be archived here.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
