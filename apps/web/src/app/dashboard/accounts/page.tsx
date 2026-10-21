import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { activateAccount, connectBybitAccount, ensurePaperAccount, requestDemoFunds, topUpPaperBalance } from "../actions";

interface AccountSummary {
  id: string;
  label: string;
  exchange: "paper" | "bybit" | "binance";
  environment: "live" | "demo";
  is_active: boolean;
  created_at: string;
  paper_balance: number | null;
}

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string; paper?: string; toppedUp?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const query = (await searchParams) ?? {};
  const { data } = await supabase
    .from("exchange_accounts")
    .select("id, label, exchange, environment, is_active, created_at, paper_balance")
    .order("created_at", { ascending: true });
  const accounts = (data ?? []) as unknown as AccountSummary[];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%", maxWidth: "1200px" }}>
      <div>
        <span className="eyebrow">Trading Workspaces</span>
        <h1 style={{ marginTop: "6px" }}>Accounts</h1>
        <p className="lead">Start with Vexqora Paper without API keys. Connect Bybit only for exchange-backed demo or live execution.</p>
      </div>

      {query?.error ? <p className="notice error">{query.error}</p> : null}
      {query?.connected ? <p className="notice success">Bybit account verified and connected successfully.</p> : null}
      {query?.paper ? <p className="notice success">Vexqora Paper is ready with 10,000 virtual USDT.</p> : null}
      {query?.toppedUp ? <p className="notice success">Paper balance updated.</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px" }}>
        {accounts.length ? (
          accounts.map((account) => (
            <article className="card" key={account.id} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className={`badge ${account.exchange === "paper" ? "demo" : account.environment}`}>{account.exchange === "paper" ? "Vexqora Paper" : `Bybit ${account.environment}`}</span>
                {account.is_active ? <span className="badge active">Active Desk</span> : null}
              </div>
              <h3 style={{ fontSize: "18px" }}>{account.label}</h3>
              <p style={{ color: "var(--muted)", fontSize: "13px" }}>{account.exchange === "paper" ? "Internal SaaS simulation · public market prices · no API key" : "BYBIT Futures · Linear USDT"}</p>
              {account.exchange === "paper" ? <div className="mono" style={{ fontSize: "24px", color: "var(--aqua)" }}>{Number(account.paper_balance ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} USDT</div> : null}

              <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingTop: "12px" }}>
                {!account.is_active ? (
                  <form action={activateAccount}>
                    <input type="hidden" name="accountId" value={account.id} />
                    <button className="button primary" style={{ width: "100%" }}>Switch to this account</button>
                  </form>
                ) : null}

                {account.exchange === "paper" ? (
                  <form action={topUpPaperBalance} style={{ display: "flex", gap: "8px" }}>
                    <input type="hidden" name="accountId" value={account.id} />
                    <input aria-label="Paper amount" name="amount" type="number" min="1" max="100000" defaultValue="10000" style={{ width: "120px", padding: "0 10px", borderRadius: "8px", border: "1px solid var(--line)", background: "var(--plum)", color: "var(--text)" }} />
                    <button className="button secondary" style={{ flex: 1 }}>Add virtual USDT</button>
                  </form>
                ) : account.environment === "demo" ? (
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
            <h3>Your SaaS workspace is not initialized</h3>
            <p style={{ marginTop: "6px" }}>Create a free Vexqora Paper account with 10,000 virtual USDT. No exchange key is required.</p>
            <form action={ensurePaperAccount} style={{ marginTop: "18px" }}><button className="button primary">Create Vexqora Paper</button></form>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: "16px" }}>
        <span className="eyebrow">Optional exchange connection</span>
        <h2 style={{ marginTop: "8px" }}>Connect Bybit</h2>
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
                <option value="demo">Bybit Demo (requires Demo API key)</option>
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
