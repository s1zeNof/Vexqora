import { createSupabaseServerClient } from "../../../lib/supabase/server";

export default async function IntegrationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  void user; // user verification

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%", maxWidth: "1000px" }}>
      <div>
        <span className="eyebrow">External Channels</span>
        <h1 style={{ marginTop: "6px" }}>Telegram & Discord Integrations</h1>
        <p className="lead">Receive real-time trade execution notifications and forward signals directly into your desk.</p>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "24px" }}>✈️</span>
          <div>
            <h3>Telegram Bot Link</h3>
            <p style={{ fontSize: "13px", color: "var(--muted)" }}>Two-way notifications and signal ingestion via private bot.</p>
          </div>
        </div>

        <div style={{ background: "var(--plum)", padding: "16px", borderRadius: "10px", marginTop: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="kicker">Your One-Time Pairing Code</div>
            <div className="mono" style={{ fontSize: "20px", fontWeight: "700", color: "var(--aqua)", marginTop: "4px" }}>
              VXQ-9842
            </div>
          </div>
          <button className="button primary">Generate New Code</button>
        </div>

        <p style={{ fontSize: "13px", color: "var(--muted)", marginTop: "12px", lineHeight: "1.6" }}>
          Open the bot <strong>@VexqoraBot</strong> in Telegram and send the command: <code className="mono" style={{ background: "#0e0b1a", padding: "2px 6px", borderRadius: "4px" }}>/link VXQ-9842</code>.
        </p>
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "24px" }}>🎮</span>
          <div>
            <h3>Discord Channel Webhook</h3>
            <p style={{ fontSize: "13px", color: "var(--muted)" }}>Post rich trade alerts, target hits, and daily summaries to your private server.</p>
          </div>
        </div>

        <form style={{ display: "grid", gap: "12px", marginTop: "16px" }}>
          <div className="form-group">
            <label>Webhook URL</label>
            <input placeholder="https://discord.com/api/webhooks/..." />
          </div>
          <button className="button secondary" type="button" style={{ width: "fit-content" }}>
            Save Discord Webhook
          </button>
        </form>
      </div>
    </div>
  );
}
