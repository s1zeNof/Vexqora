import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { SettingsNav } from "../settings-nav";

export default async function IntegrationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  void user;

  return (
    <div className="settings-layout">
      <SettingsNav />

      <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
        <div>
          <h1 style={{ margin: 0, font: "700 24px Inter, sans-serif" }}>Integrations</h1>
          <p className="lb" style={{ marginTop: "4px" }}>
            Real-time trade execution notifications and signal forwarding via Telegram and Discord.
          </p>
        </div>

        {/* Telegram Card */}
        <div className="cd" style={{ padding: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#1A1A1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#42F5B9" strokeWidth="1.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "16px" }}>Telegram Bot Connection</h3>
              <p className="lb" style={{ marginTop: "2px" }}>Two-way notifications and signal ingestion via private bot.</p>
            </div>
          </div>

          <div style={{ background: "#1A1A1A", border: "1px solid #262626", padding: "14px 16px", borderRadius: "8px", marginTop: "16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
            <div>
              <div className="lb">One-Time Pairing Code</div>
              <div style={{ font: "700 20px Inter", fontVariantNumeric: "tabular-nums", color: "#42F5B9", marginTop: "4px" }}>
                VXQ-9842
              </div>
            </div>
            <button type="button" className="bt pr sm">Generate New Code</button>
          </div>

          <p className="lb" style={{ marginTop: "12px", lineHeight: "1.6" }}>
            Open <strong>@VexqoraBot</strong> in Telegram and send: <code style={{ background: "#1A1A1A", border: "1px solid #262626", padding: "2px 6px", borderRadius: "4px", color: "#FFFFFF" }}>/link VXQ-9842</code>.
          </p>
        </div>

        {/* Discord Card */}
        <div className="cd" style={{ padding: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#1A1A1A", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#42F5B9" strokeWidth="1.5">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "16px" }}>Discord Webhook</h3>
              <p className="lb" style={{ marginTop: "2px" }}>Post trade alerts and summaries to your Discord server.</p>
            </div>
          </div>

          <form style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label className="lb">Webhook URL</label>
              <input placeholder="https://discord.com/api/webhooks/..." />
            </div>
            <button type="button" className="bt" style={{ alignSelf: "flex-start" }}>
              Save Discord Webhook
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
