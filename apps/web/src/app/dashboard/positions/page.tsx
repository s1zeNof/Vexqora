import type { TradeRow } from "@crypto-bot/shared";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { VexqoraLogo } from "../../../components/logo";

export default async function PositionsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: active } = await supabase.from("exchange_accounts").select("id, label, environment").eq("is_active", true).limit(1).maybeSingle();
  const trades = (active
    ? (await supabase.from("trades").select("*").eq("account_id", active.id).eq("status", "active")).data
    : []) as TradeRow[] | null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <span className="eyebrow">Realtime Execution</span>
          <h1 style={{ marginTop: "6px" }}>Open Positions</h1>
          <p className="lead">Open positions for the active paper or exchange-backed workspace.</p>
        </div>
        <button className="button danger" disabled={!trades?.length}>Close all positions</button>
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
              trades.map((trade) => (
                <tr key={trade.id}>
                  <td><strong>{trade.symbol}</strong></td>
                  <td><span className={`badge ${trade.side}`}>{trade.side} {trade.leverage}x</span></td>
                  <td className="mono">{trade.qty}</td>
                  <td className="mono">{trade.entry_avg}</td>
                  <td className="mono">—</td>
                  <td className="mono negative">{trade.sl ?? "—"}</td>
                  <td className="mono warning">{trade.trailing_stop ? "configured" : "—"}</td>
                  <td className="mono">—</td>
                  <td>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button className="button secondary" disabled style={{ minHeight: "32px", padding: "0 10px", fontSize: "12px" }}>Close 50%</button>
                      <button className="button danger" disabled style={{ minHeight: "32px", padding: "0 10px", fontSize: "12px" }}>Market Close</button>
                    </div>
                  </td>
                </tr>
              ))
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
