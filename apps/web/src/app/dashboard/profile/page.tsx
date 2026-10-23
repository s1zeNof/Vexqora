import type { ProfileRow, TradeRow } from "@crypto-bot/shared";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { signOut } from "../../login/actions";
import { addPaperDepositAction, removePaperDepositAction, updateProfile } from "../actions";

const profileAccountSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  exchange: z.enum(["paper", "bybit", "binance"]),
  environment: z.enum(["live", "demo"]),
  paper_balance: z.coerce.number().nullable()
});

export default async function ProfilePage({
  searchParams
}: {
  searchParams: Promise<{ saved?: string; depositAdded?: string; fundsRemoved?: string; error?: string }>;
}) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const query = (await searchParams) ?? {};

  const [profileRes, accountRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("exchange_accounts")
      .select("id, label, exchange, environment, paper_balance")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle()
  ]);

  const profile = profileRes.data as ProfileRow | null;
  const activeAccount = accountRes.data ? profileAccountSchema.safeParse(accountRes.data).data ?? null : null;

  const tradesRes = activeAccount
    ? await supabase.from("trades").select("*").eq("account_id", activeAccount.id).order("opened_at", { ascending: false }).limit(100)
    : { data: [] };

  const trades = (tradesRes.data ?? []) as TradeRow[];
  const closedTrades = trades.filter(t => t.status === "closed");


  const winningTrades = closedTrades.filter(t => Number(t.realized_pnl) > 0);
  const losingTrades = closedTrades.filter(t => Number(t.realized_pnl) < 0);

  const totalRealizedPnl = closedTrades.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0);
  const grossProfit = winningTrades.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0));

  const winRatePct = closedTrades.length > 0
    ? ((winningTrades.length / closedTrades.length) * 100).toFixed(1)
    : null;
  const profitFactor = grossLoss > 0
    ? (grossProfit / grossLoss).toFixed(2)
    : (grossProfit > 0 ? "MAX" : "—");

  const avgWin = winningTrades.length > 0 ? (grossProfit / winningTrades.length).toFixed(2) : "0.00";
  const avgLoss = losingTrades.length > 0 ? (grossLoss / losingTrades.length).toFixed(2) : "0.00";

  const displayName = profile?.display_name ?? user.email?.split("@")[0] ?? "Trader";
  const avatarLetter = displayName.charAt(0).toUpperCase();

  const currentEquity = activeAccount?.exchange === "paper"
    ? Number(activeAccount.paper_balance ?? 10000)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0, width: "100%" }}>
        <div>
          <h1 style={{ margin: 0, font: "700 24px Inter, sans-serif" }}>Profile</h1>
          <p className="lb" style={{ marginTop: "4px" }}>
            Account telemetry, performance statistics and security configuration.
          </p>
        </div>

        {query.saved && <p className="notice success">Profile updated successfully.</p>}
        {query.depositAdded && <p className="notice success">Virtual funds added to the Paper balance.</p>}
        {query.fundsRemoved && <p className="notice success">Virtual funds removed from the Paper balance.</p>}
        {query.error && <p className="notice error">{query.error}</p>}

        {/* Identity & Balance Card */}
        <div className="cd" style={{ padding: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "24px",
                background: "#1A1A1A",
                border: "1px solid #262626",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "18px",
                fontWeight: 700,
                color: "#FFFFFF"
              }}
            >
              {avatarLetter}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h2 style={{ margin: 0, fontSize: "18px" }}>{displayName}</h2>
                <span className="tg gy">
                  {activeAccount?.exchange === "paper" ? "Paper Operator" : activeAccount?.environment?.toUpperCase() ?? "Demo"}
                </span>
              </div>
              <div className="lb" style={{ marginTop: "2px" }}>{user.email}</div>
            </div>
          </div>

          <div style={{ textAlign: "right" }}>
            <div className="lb">Paper Virtual Equity</div>
            <div style={{ font: "700 22px Inter", fontVariantNumeric: "tabular-nums", color: "#42F5B9", marginTop: "2px" }}>
              {currentEquity !== null
                ? `${currentEquity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
                : "Bybit Connected"}
            </div>
            {activeAccount?.exchange === "paper" && (
              <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end", flexWrap: "wrap", marginTop: "8px" }}>
                <form action={addPaperDepositAction} style={{ display: "flex", gap: "4px" }}>
                  <input type="hidden" name="accountId" value={activeAccount.id} />
                  <input name="amount" type="number" min="0.01" max="100000" step="0.01" defaultValue="10000" aria-label="Amount to add" style={{ width: "110px" }} />
                  <button type="submit" className="bt pr sm">Add</button>
                </form>
                <form action={removePaperDepositAction} style={{ display: "flex", gap: "4px" }}>
                  <input type="hidden" name="accountId" value={activeAccount.id} />
                  <input name="amount" type="number" min="0.01" max={currentEquity ?? 0} step="0.01" placeholder="Amount" aria-label="Amount to remove" style={{ width: "110px" }} required />
                  <button type="submit" className="bt dn sm">Remove</button>
                </form>
              </div>
            )}
          </div>
        </div>

        {/* Performance Metrics Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
          <div className="cd" style={{ padding: "16px" }}>
            <div className="lb">Win Rate</div>
            <div style={{ font: "700 22px Inter", fontVariantNumeric: "tabular-nums", color: winRatePct && Number(winRatePct) >= 50 ? "#42F5B9" : "#FF5A6E", marginTop: "4px" }}>
              {winRatePct !== null ? `${winRatePct}%` : "—"}
            </div>
            <div className="lb" style={{ fontSize: "11px", marginTop: "2px" }}>
              {winningTrades.length} won / {losingTrades.length} lost
            </div>
          </div>

          <div className="cd" style={{ padding: "16px" }}>
            <div className="lb">Realized PnL</div>
            <div style={{ font: "700 22px Inter", fontVariantNumeric: "tabular-nums", color: totalRealizedPnl >= 0 ? "#42F5B9" : "#FF5A6E", marginTop: "4px" }}>
              {totalRealizedPnl >= 0 ? "+" : ""}${totalRealizedPnl.toFixed(2)}
            </div>
            <div className="lb" style={{ fontSize: "11px", marginTop: "2px" }}>
              Net closed contracts
            </div>
          </div>

          <div className="cd" style={{ padding: "16px" }}>
            <div className="lb">Profit Factor</div>
            <div style={{ font: "700 22px Inter", fontVariantNumeric: "tabular-nums", color: "#FFFFFF", marginTop: "4px" }}>
              {profitFactor}
            </div>
            <div className="lb" style={{ fontSize: "11px", marginTop: "2px" }}>
              Gross win/loss ratio
            </div>
          </div>

          <div className="cd" style={{ padding: "16px" }}>
            <div className="lb">Avg Win / Loss</div>
            <div style={{ font: "700 16px Inter", fontVariantNumeric: "tabular-nums", marginTop: "6px" }}>
              <span style={{ color: "#42F5B9" }}>+${avgWin}</span> / <span style={{ color: "#FF5A6E" }}>-${avgLoss}</span>
            </div>
            <div className="lb" style={{ fontSize: "11px", marginTop: "2px" }}>
              Per settled trade
            </div>
          </div>
        </div>

        {/* User Details & Name Form */}
        <div className="cd" style={{ padding: "20px" }}>
          <h3 style={{ margin: 0, fontSize: "16px" }}>User Details & Security</h3>
          <form action={updateProfile} style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "16px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxWidth: "400px" }}>
              <label className="lb">Display Name</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input name="displayName" defaultValue={displayName} maxLength={80} required />
                <button type="submit" className="bt pr">Save</button>
              </div>
            </div>

            <div style={{ borderTop: "1px solid #262626", paddingTop: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="lb">Terminate active session on this device:</span>
              <form action={signOut}>
                <button type="submit" className="bt dn sm">
                  Sign out
                </button>
              </form>
            </div>
          </form>
        </div>
    </div>
  );
}
