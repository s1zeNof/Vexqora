import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { SignalComposer } from "./signal-composer";
import { z } from "zod";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ error?: string; queued?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const { data: active } = await supabase.from("exchange_accounts").select("id, label, environment").eq("is_active", true).single();
  const account = z.object({ id: z.string(), label: z.string(), environment: z.string() }).nullable().parse(active);
  const { data } = account ? await supabase.from("chat_messages").select("id, role, kind, content, created_at")
    .eq("account_id", account.id).order("created_at", { ascending: false }).limit(30) : { data: [] };
  const messages = z.array(z.object({
    id: z.string(), role: z.string(), kind: z.string(), content: z.string(), created_at: z.string()
  })).parse(data ?? []);

  return (
    <main className="terminal-layout">
      <aside className="sidebar">
        <Link className="brand" href="/"><span className="brand-mark" />Vexqora Trade</Link>
        <nav className="side-nav">
          <Link className="active" href="/dashboard/chat">Signals chat</Link>
          <span>Positions</span><span>History</span>
          <Link href="/dashboard">Accounts</Link>
          <span>Risk limits</span><span>Telegram · Discord</span>
        </nav>
        <div className="sidebar-foot"><span className="status-dot" /> Systems nominal</div>
      </aside>
      <section className="terminal-main">
        <header className="topbar">
          <div><strong>{account?.label ?? "No account"}</strong><span className="exchange-label">Bybit</span></div>
          {account ? <span className={`badge ${account.environment}`}>{account.environment}</span> : null}
          <div className="topbar-actions"><span className="mono balance">— USDT</span><button className="button secondary">Top up demo</button><button className="button danger">Kill switch</button></div>
        </header>
        <div className="terminal-content">
          <section className="metric-grid">
            <article className="panel metric"><span className="kicker">Equity</span><strong className="mono">—</strong><svg viewBox="0 0 96 32" aria-hidden="true"><path d="M0 26 L14 22 L26 24 L40 14 L54 17 L68 8 L82 11 L96 3" /></svg></article>
            <article className="panel metric"><span className="kicker">Today PnL</span><strong className="mono positive">$0.00</strong></article>
            <article className="panel metric"><span className="kicker">Open risk</span><strong className="mono">0.0% <small>of daily limit</small></strong></article>
            <article className="panel metric"><span className="kicker">Win rate · 7D</span><strong className="mono">—</strong></article>
          </section>
          {query.error ? <p className="notice error">{query.error}</p> : null}
          {query.queued ? <p className="notice success">Signal queued for execution.</p> : null}
          <section className="trade-workspace">
            <div className="panel chat-panel">
              <div className="chat-scroll">
                {messages.length ? messages.map((message) => <article className={`message ${message.role}`} key={message.id}><small>{message.kind.replaceAll("_", " ")}</small><p>{message.content}</p></article>) : <div className="empty-state"><span className="brand-mark" /><h2>Your signal desk is ready</h2><p>Paste a signal below to validate its levels and calculate risk.</p></div>}
              </div>
              {account ? <SignalComposer /> : <p className="error">Connect an exchange account before creating a preview.</p>}
            </div>
            <aside className="panel active-trade">
              <div className="active-title"><strong>No active trade</strong><span className="badge demo">Waiting</span></div>
              <div className="pnl mono">$0.00</div>
              <span className="kicker">Levels</span>
              <div className="level"><span className="positive">TP3</span><span>—</span></div>
              <div className="level"><span className="positive">TP2</span><span>—</span></div>
              <div className="level muted"><span className="positive">TP1</span><span>—</span></div>
              <div className="level"><span className="demo-text">Entry</span><span>—</span></div>
              <div className="level"><span className="negative">SL</span><span>—</span></div>
              <div className="level"><span className="warning">Trail</span><span>inactive</span></div>
              <div className="trade-controls"><button className="button secondary" disabled>Close 50%</button><button className="button secondary" disabled>Move SL to breakeven</button><button className="button danger" disabled>Close all</button></div>
            </aside>
          </section>
        </div>
      </section>
    </main>
  );
}

