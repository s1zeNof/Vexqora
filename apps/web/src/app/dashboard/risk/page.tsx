import type { RiskSettingsRow } from "@crypto-bot/shared";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export default async function RiskSettingsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: active } = await supabase.from("exchange_accounts").select("id, label, environment").eq("is_active", true).single();
  const riskRes = active ? await supabase.from("risk_settings").select("*").eq("account_id", active.id).single() : { data: null };
  const risk = riskRes.data as RiskSettingsRow | null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%", maxWidth: "1000px" }}>
      <div>
        <span className="eyebrow">Risk Engine</span>
        <h1 style={{ marginTop: "6px" }}>Risk Management & Limits</h1>
        <p className="lead">Rules applied identically to both Demo and Live executions to protect capital.</p>
      </div>

      <div className="card" style={{ borderLeft: "4px solid var(--pink)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ color: "var(--pink)" }}>Emergency Kill Switch</h3>
            <p style={{ fontSize: "14px", marginTop: "4px" }}>
              Instantly cancels all pending entries and blocks new trade signals across this account.
            </p>
          </div>
          <button className="button danger" style={{ minHeight: "44px", padding: "0 20px" }}>
            Trigger Kill Switch
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Position Sizing & Account Safety</h3>
        <form style={{ display: "grid", gap: "16px", marginTop: "20px" }}>
          <div className="form-grid">
            <div className="form-group">
              <label>Risk Per Trade (% of Balance)</label>
              <input type="number" step="0.1" min="0.1" max="10" defaultValue={risk?.risk_per_trade_pct ?? 1.0} />
              <small style={{ color: "var(--muted)", fontSize: "11px" }}>Used to dynamically calculate order quantity: qty = (balance × risk) / |entry − SL|</small>
            </div>
            <div className="form-group">
              <label>Max Leverage Allowed</label>
              <input type="number" min="1" max="50" defaultValue={risk?.max_leverage ?? 5} />
              <small style={{ color: "var(--muted)", fontSize: "11px" }}>Hard ceiling. Any signal requesting higher leverage will be rejected.</small>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label>Max Daily Loss (% of Account)</label>
              <input type="number" step="0.5" min="1" max="20" defaultValue={risk?.max_daily_loss_pct ?? 5.0} />
              <small style={{ color: "var(--muted)", fontSize: "11px" }}>If daily drawdown hits this threshold, new trade execution is halted until next UTC day.</small>
            </div>
            <div className="form-group">
              <label>Max Concurrent Open Positions</label>
              <input type="number" min="1" max="10" defaultValue={risk?.max_open_positions ?? 3} />
              <small style={{ color: "var(--muted)", fontSize: "11px" }}>Prevents over-exposure by limiting the number of simultaneously open trades.</small>
            </div>
          </div>

          <button className="button primary" type="button" style={{ width: "fit-content", padding: "0 24px", marginTop: "8px" }}>
            Save Risk Parameters
          </button>
        </form>
      </div>
    </div>
  );
}
