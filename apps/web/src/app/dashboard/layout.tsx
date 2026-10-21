import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { signOut } from "../login/actions";
import { z } from "zod";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: active } = await supabase
    .from("exchange_accounts")
    .select("id, label, environment, exchange")
    .eq("is_active", true)
    .single();

  const account = z.object({
    id: z.string(),
    label: z.string(),
    environment: z.string(),
    exchange: z.string()
  }).nullable().parse(active);

  return (
    <div className="terminal-layout">
      <aside className="sidebar">
        <Link className="brand" href="/dashboard/chat">
          <span className="brand-mark" />
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
          <div className="sidebar-user" title={user.email}>{user.email}</div>
          <div><span className="status-dot" /> Systems nominal</div>
        </div>
      </aside>

      <div className="terminal-main">
        <header className="topbar">
          <div className="topbar-title">
            <strong>{account?.label ?? "No account connected"}</strong>
            {account ? <span className="kicker" style={{ fontSize: "11px" }}>{account.exchange.toUpperCase()}</span> : null}
            {account ? <span className={`badge ${account.environment}`}>{account.environment}</span> : null}
          </div>
          <div className="topbar-actions">
            <span className="mono balance">— USDT</span>
            {account?.environment === "demo" ? (
              <Link href="/dashboard/accounts" className="button secondary" style={{ minHeight: "36px", padding: "0 12px", fontSize: "12px" }}>
                Top up demo
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
