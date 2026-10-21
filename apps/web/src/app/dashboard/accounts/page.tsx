import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { activateAccount, connectBybitAccount, requestDemoFunds } from "../actions";

interface AccountSummary {
  id: string;
  label: string;
  exchange: string;
  environment: "live" | "demo";
  is_active: boolean;
  created_at: string;
}

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const query = await searchParams;
  const { data } = await supabase
    .from("exchange_accounts")
    .select("id, label, exchange, environment, is_active, created_at")
    .order("created_at", { ascending: true });
  const accounts = (data ?? []) as unknown as AccountSummary[];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%", maxWidth: "1200px" }}>
      <div>
        <span className="eyebrow">API Credentials</span>
        <h1 style={{ marginTop: "6px" }}>Exchange Accounts</h1>
        <p className="lead">Credentials are encrypted with server-side AES-256-GCM. Withdraw permissions must remain disabled.</p>
      </div>

      {query.error ? <p className="notice error">{query.error}</p> : null}
      {query.connected ? <p className="notice success">Bybit account verified and connected successfully.</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px" }}>
        {accounts.length ? (
          accounts.map((account) => (
            <article className="card" key={account.id} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className={`badge ${account.environment}`}>{account.environment}</span>
                {account.is_active ? <span className="badge active">Active Desk</span> : null}
              </div>
              <h3 style={{ fontSize: "18px" }}>{account.label}</h3>
              <p style={{ color: "var(--muted)", fontSize: "13px" }}>{account.exchange.toUpperCase()} Futures (Linear USDT)</p>

              <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingTop: "12px" }}>
                {!account.is_active ? (
                  <form action={activateAccount}>
                    <input type="hidden" name="accountId" value={account.id} />
                    <button className="button primary" style={{ width: "100%" }}>Switch to this account</button>
                  </form>
                ) : null}

                {account.environment === "demo" ? (
                  <form action={requestDemoFunds} style={{ display: "flex", gap: "8px" }}>
                    <input type="hidden" name="accountId" value={account.id} />
                    <input aria-label="Demo amount" name="amount" type="number" min="1" max="100000" defaultValue="10000" style={{ width: "120px", padding: "0 10px", borderRadius: "8px", border: "1px solid var(--line)", background: "var(--plum)", color: "var(--text)" }} />
                    <button className="button secondary" style={{ flex: 1 }}>Add Demo USDT</button>
                  </form>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <div className="card" style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px" }}>
            <h3>No exchange accounts connected yet</h3>
            <p style={{ marginTop: "6px" }}>Connect your Bybit Demo or Live API keys below to enable signal execution.</p>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: "16px" }}>
        <span className="eyebrow">Connect Exchange</span>
        <h2 style={{ marginTop: "8px" }}>Add Bybit Account</h2>
        <p style={{ color: "var(--muted)", marginTop: "4px", fontSize: "14px" }}>
          Create an API key in your Bybit account under Account & Security → API Management. Select <strong>Read and Trade</strong> permissions only.
        </p>

        <form action={connectBybitAccount} style={{ display: "grid", gap: "16px", marginTop: "20px" }}>
          <div className="form-grid">
            <div className="form-group">
              <label>Account Label</label>
              <input name="label" placeholder="e.g. Bybit Main Demo" required />
            </div>
            <div className="form-group">
              <label>Environment</label>
              <select name="environment" defaultValue="demo">
                <option value="demo">Demo Trading (Virtual balance, real prices)</option>
                <option value="live">Live Trading (Real funds)</option>
              </select>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-group">
              <label>API Key</label>
              <input name="apiKey" placeholder="Bybit API Key" autoComplete="off" required />
            </div>
            <div className="form-group">
              <label>API Secret</label>
              <input name="apiSecret" type="password" placeholder="Bybit API Secret" autoComplete="new-password" required />
            </div>
          </div>
          <button className="button primary" style={{ width: "fit-content", padding: "0 28px", marginTop: "8px" }}>
            Verify & Connect Bybit
          </button>
        </form>
      </div>
    </div>
  );
}
