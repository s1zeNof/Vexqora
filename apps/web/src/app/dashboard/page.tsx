import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { activateAccount, connectBybitAccount, requestDemoFunds } from "./actions";
import Link from "next/link";

interface AccountSummary {
  id: string;
  label: string;
  exchange: string;
  environment: "live" | "demo";
  is_active: boolean;
  created_at: string;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const { data } = await supabase.from("exchange_accounts")
    .select("id, label, exchange, environment, is_active, created_at")
    .order("created_at", { ascending: true });
  const accounts = (data ?? []) as unknown as AccountSummary[];

  return (
    <main className="shell">
      <p className="eyebrow">Secure workspace</p>
      <h1>Exchange accounts</h1>
      <p className="lead">Signed in as {user.email}. Credentials are verified server-side and stored with AES-256-GCM encryption.</p>
      <p><Link href="/dashboard/chat">Open signal chat →</Link></p>
      {query.error ? <p className="error">{query.error}</p> : null}
      {query.connected ? <p className="success">Bybit account connected.</p> : null}

      <section className="account-grid">
        {accounts?.map((account) => (
          <article className="card account" key={account.id}>
            <div><span className={`badge ${account.environment}`}>{account.environment}</span>{account.is_active ? <span className="badge active">active</span> : null}</div>
            <h2>{account.label}</h2>
            <p>{account.exchange.toUpperCase()} account</p>
            {!account.is_active ? <form action={activateAccount}><input type="hidden" name="accountId" value={account.id} /><button>Make active</button></form> : null}
            {account.environment === "demo" ? (
              <form className="funds" action={requestDemoFunds}>
                <input type="hidden" name="accountId" value={account.id} />
                <input aria-label="Demo amount" name="amount" type="number" min="1" max="100000" defaultValue="10000" />
                <button>Add demo USDT</button>
              </form>
            ) : null}
          </article>
        ))}
      </section>

      <section className="connect">
        <p className="eyebrow">New connection</p>
        <h2>Connect Bybit</h2>
        <p>Use an API key with Read and Trade permissions only. Withdraw permission must remain disabled.</p>
        <form className="auth" action={connectBybitAccount}>
          <label>Label<input name="label" placeholder="My demo account" required /></label>
          <label>Environment<select name="environment" defaultValue="demo"><option value="demo">Demo</option><option value="live">Live</option></select></label>
          <label>API key<input name="apiKey" autoComplete="off" required /></label>
          <label>API secret<input name="apiSecret" type="password" autoComplete="new-password" required /></label>
          <button>Verify and connect</button>
        </form>
      </section>
    </main>
  );
}

