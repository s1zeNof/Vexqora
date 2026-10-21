import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { signOut } from "../login/actions";
import { VexqoraLogo } from "../../components/logo";
import { z } from "zod";
import { accountConnectionSchema, createAccountClient } from "../../lib/account-client";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  try {
    await supabase.rpc("ensure_user_workspace", { target_user_id: user.id });
  } catch {
    // Graceful fallback if workspace already initialized or RPC unavailable
  }

  const { data: active } = await supabase
    .from("exchange_accounts")
    .select("id, label, environment, exchange, api_key_enc, api_secret_enc, paper_balance")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const account = accountConnectionSchema.nullable().safeParse(active).data ?? null;
  const { data: rawProfile } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const profile = z.object({ display_name: z.string().nullable() }).nullable().safeParse(rawProfile).data ?? null;
  let availableBalance: number | null = null;
  if (account) {
    try { availableBalance = (await createAccountClient(account).getBalance()).available; } catch { availableBalance = null; }
  }

  return (
    <div className="terminal-layout">
      <aside className="sidebar">
        <Link className="brand" href="/dashboard/chat">
          <VexqoraLogo size={24} />
          <span>Vexqora Trade</span>
        </Link>
        <nav className="side-nav">
          <Link href="/dashboard/chat">⚡ Signals chat</Link>
          <Link href="/dashboard/positions">📊 Positions</Link>
          <Link href="/dashboard/history">📜 History</Link>
          <Link href="/dashboard/accounts">🔑 Accounts</Link>
          <Link href="/dashboard/risk">🛡️ Risk limits</Link>
          <Link href="/dashboard/integrations">💬 Integrations</Link>
          <Link href="/dashboard/profile">👤 Profile</Link>
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-user" title={user.email}>{profile?.display_name ?? user.email}</div>
          <div><span className="status-dot" /> Systems nominal</div>
        </div>
      </aside>

      <div className="terminal-main">
        <header className="topbar">
          <div className="topbar-title">
            <strong>{account?.label ?? "Workspace initializing"}</strong>
            {account ? <span className="kicker" style={{ fontSize: "11px" }}>{account.exchange.toUpperCase()}</span> : null}
            {account ? <span className={`badge ${account.environment}`}>{account.environment}</span> : null}
          </div>
          <div className="topbar-actions">
            <span className="mono balance">{availableBalance === null ? "—" : availableBalance.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDT</span>
            {account?.environment === "demo" ? (
              <Link href="/dashboard/accounts" className="button secondary" style={{ minHeight: "36px", padding: "0 12px", fontSize: "12px" }}>
                Add virtual funds
              </Link>
            ) : null}
            <Link href="/dashboard/risk" className="button danger" style={{ minHeight: "36px", padding: "0 12px", fontSize: "12px" }}>
              Kill switch
            </Link>
            <form action={signOut}>
              <button className="button secondary" style={{ minHeight: "36px", padding: "0 12px", fontSize: "12px" }}>
                Sign out
              </button>
            </form>
          </div>
        </header>

        <main className="terminal-content">
          {children}
        </main>
      </div>
    </div>
  );
}
