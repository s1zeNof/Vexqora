import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { activateAccount, connectBybitAccount, ensurePaperAccount, removePaperBalance, requestDemoFunds, topUpPaperBalance } from "../actions";
import { SettingsNav } from "../settings-nav";

interface AccountSummary {
  id: string;
  label: string;
  exchange: "paper" | "bybit" | "binance";
  environment: "live" | "demo";
  is_active: boolean;
  created_at: string;
  paper_balance: number | null;
}

export default async function AccountsPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; connected?: string; paper?: string; toppedUp?: string; withdrawn?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const query = (await searchParams) ?? {};
  const { data } = await supabase
    .from("exchange_accounts")
    .select("id, label, exchange, environment, is_active, created_at, paper_balance")
    .order("created_at", { ascending: true });
  const accounts = (data ?? []) as unknown as AccountSummary[];

  return (
    <div className="settings-layout">
      <SettingsNav />

      <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
        <div>
          <h1 style={{ margin: 0, font: "700 24px Inter, sans-serif" }}>Accounts</h1>
          <p className="lb" style={{ marginTop: "4px" }}>
            Start with Vexqora Paper without API keys. Connect Bybit only for exchange-backed demo or live execution.
          </p>
        </div>

        {query?.error && <p className="notice error">{query.error}</p>}
        {query?.connected && <p className="notice success">Bybit account verified and connected successfully.</p>}
        {query?.paper && <p className="notice success">Vexqora Paper is ready with 10,000 virtual USDT.</p>}
        {query?.toppedUp && <p className="notice success">Paper balance updated.</p>}
        {query?.withdrawn && <p className="notice success">Virtual funds removed from the Paper balance.</p>}

        {/* Accounts Table */}
        <div className="cd" style={{ overflow: "hidden" }}>
          <div className="table-responsive">
          <table className="dt-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Mode</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length ? (
                accounts.map((account) => {
                  const isPaper = account.exchange === "paper";
                  const isLive = account.environment === "live" && !isPaper;
                  return (
                    <tr key={account.id}>
                      <td>
                        <strong style={{ color: "#FFFFFF" }}>{account.label}</strong>
                        <div className="lb" style={{ fontSize: "11px", marginTop: "2px" }}>
                          {isPaper ? "Simulation · No API key" : "Bybit USDT Linear"}
                        </div>
                      </td>
                      <td>
                        <span className={`tg ${isLive ? "warn" : isPaper ? "gy" : "lg"}`}>
                          <i
                            style={{
                              width: "6px",
                              height: "6px",
                              borderRadius: "3px",
                              background: isLive ? "#F5C451" : "#42F5B9",
                              display: "inline-block"
                            }}
                          />
                          {isPaper ? "Paper · VEXQORA" : isLive ? "Bybit LIVE" : "Bybit DEMO"}
                        </span>
                      </td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>
                        {isPaper ? `${Number(account.paper_balance ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} USDT` : "Exchange"}
                      </td>
                      <td>
                        {account.is_active ? (
                          <span className="tg active">Active Desk</span>
                        ) : (
                          <span className="lb">Standby</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          {!account.is_active && (
                            <form action={activateAccount}>
                              <input type="hidden" name="accountId" value={account.id} />
                              <button type="submit" className="bt sm pr">
                                Switch
                              </button>
                            </form>
                          )}

                          {isPaper ? (
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              <form action={topUpPaperBalance} style={{ display: "flex", gap: "4px" }}>
                                <input type="hidden" name="accountId" value={account.id} />
                                <input name="amount" type="number" min="0.01" max="100000" step="0.01" defaultValue="10000" aria-label="Amount to add" style={{ width: "105px" }} />
                                <button type="submit" className="bt sm">Add</button>
                              </form>
                              <form action={removePaperBalance} style={{ display: "flex", gap: "4px" }}>
                                <input type="hidden" name="accountId" value={account.id} />
                                <input name="amount" type="number" min="0.01" max={Number(account.paper_balance ?? 0)} step="0.01" placeholder="Amount" aria-label="Amount to remove" style={{ width: "105px" }} required />
                                <button type="submit" className="bt sm dn">Remove</button>
                              </form>
                            </div>
                          ) : account.environment === "demo" ? (
                            <form action={requestDemoFunds} style={{ display: "flex", gap: "4px" }}>
                              <input type="hidden" name="accountId" value={account.id} />
                              <input type="hidden" name="amount" value="10000" />
                              <button type="submit" className="bt sm">
                                +Demo funds
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: "32px 16px" }}>
                    <p style={{ color: "#FFFFFF", fontWeight: 600 }}>No accounts provisioned</p>
                    <form action={ensurePaperAccount} style={{ marginTop: "12px" }}>
                      <button type="submit" className="bt pr">Create Vexqora Paper</button>
                    </form>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>

        {/* Connect Bybit Card */}
        <div className="cd" style={{ padding: "20px" }}>
          <h2 style={{ fontSize: "17px", margin: 0 }}>Connect Bybit Exchange</h2>
          <p className="lb" style={{ marginTop: "4px" }}>
            Create an API key in Bybit under Account & Security → API Management with <strong>Read and Trade</strong> permissions only.
          </p>

          <form action={connectBybitAccount} style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label className="lb">Account Label</label>
                <input name="label" placeholder="e.g. Bybit Main Demo" required />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label className="lb">Environment</label>
                <select name="environment" defaultValue="demo">
                  <option value="demo">Bybit Demo</option>
                  <option value="live">Bybit Live (Real funds)</option>
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label className="lb">API Key</label>
                <input name="apiKey" type="password" placeholder="Paste Bybit API key" required />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label className="lb">API Secret</label>
                <input name="apiSecret" type="password" placeholder="Paste Bybit API secret" required />
              </div>
            </div>

            <button type="submit" className="bt pr" style={{ alignSelf: "flex-start", marginTop: "4px" }}>
              Verify & Connect Bybit
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
