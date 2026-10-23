import type { RiskSettingsRow } from "@crypto-bot/shared";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { SettingsNav } from "../settings-nav";

export default async function RiskSettingsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: active } = await supabase.from("exchange_accounts").select("id, label, environment").eq("is_active", true).limit(1).maybeSingle();
  const riskRes = active ? await supabase.from("risk_settings").select("*").eq("account_id", active.id).maybeSingle() : { data: null };
  const risk = riskRes.data as RiskSettingsRow | null;

  return (
    <div className="settings-layout">
      <SettingsNav />

      <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
        <div>
          <h1 style={{ margin: 0, font: "700 24px Inter, sans-serif" }}>Risk limits</h1>
          <p className="lb" style={{ marginTop: "4px" }}>
            Rules applied identically to both Demo and Live executions to safeguard capital.
          </p>
        </div>

        {/* Emergency Kill Switch */}
        <div className="cd" style={{ padding: "20px", borderLeft: "3px solid #FF5A6E" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <h3 style={{ margin: 0, color: "#FF5A6E", fontSize: "16px" }}>Emergency Kill Switch</h3>
              <p className="lb" style={{ marginTop: "4px" }}>
                Instantly cancels all pending entries and blocks new trade signals across this workspace.
              </p>
            </div>
            <button type="button" className="bt dn" style={{ height: "40px" }}>
              Trigger Kill Switch
            </button>
          </div>
        </div>

        {/* Position Sizing & Safety Card */}
        <div className="cd" style={{ padding: "20px" }}>
          <h3 style={{ margin: 0, fontSize: "16px" }}>Position Sizing & Account Safety</h3>
          <form style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label className="lb">Risk Per Trade (% of Balance)</label>
                <input type="number" step="0.1" min="0.1" max="10" defaultValue={risk?.risk_per_trade_pct ?? 1.0} />
                <span className="lb" style={{ fontSize: "11px" }}>Calculates qty: (balance × risk) / |entry − SL|</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label className="lb">Max Leverage Allowed</label>
                <input type="number" min="1" max="50" defaultValue={risk?.max_leverage ?? 5} />
                <span className="lb" style={{ fontSize: "11px" }}>Ceiling applied to all incoming signals</span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label className="lb">Max Daily Loss (% of Account)</label>
                <input type="number" step="0.5" min="1" max="20" defaultValue={risk?.max_daily_loss_pct ?? 5.0} />
                <span className="lb" style={{ fontSize: "11px" }}>Execution halts if daily drawdown hits threshold</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label className="lb">Max Concurrent Open Positions</label>
                <input type="number" min="1" max="10" defaultValue={risk?.max_open_positions ?? 3} />
                <span className="lb" style={{ fontSize: "11px" }}>Limits simultaneously open trades</span>
              </div>
            </div>

            <button type="button" className="bt pr" style={{ alignSelf: "flex-start", marginTop: "4px" }}>
              Save Risk Parameters
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
