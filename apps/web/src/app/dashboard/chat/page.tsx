import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { SignalComposer } from "./signal-composer";
import { VexqoraLogo } from "../../../components/logo";
import { z } from "zod";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ error?: string; queued?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const query = await searchParams;
  const { data: active } = await supabase.from("exchange_accounts").select("id, label, environment").eq("is_active", true).single();
  const account = z.object({ id: z.string(), label: z.string(), environment: z.string() }).nullable().parse(active);
  const { data } = account ? await supabase.from("chat_messages").select("id, role, kind, content, created_at")
    .eq("account_id", account.id).order("created_at", { ascending: false }).limit(30) : { data: [] };
  const messages = z.array(z.object({
    id: z.string(), role: z.string(), kind: z.string(), content: z.string(), created_at: z.string()
  })).parse(data ?? []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}>
      <section className="metric-grid">
        <article className="panel metric">
          <div className="metric-data">
            <span className="kicker">Equity</span>
            <strong className="mono">10,184.20 USDT</strong>
          </div>
          <svg width="80" height="28" viewBox="0 0 96 32" aria-hidden="true">
            <path d="M0 26 L14 22 L26 24 L40 14 L54 17 L68 8 L82 11 L96 3" fill="none" stroke="var(--soft-violet)" strokeWidth="2" />
          </svg>
        </article>
        <article className="panel metric">
          <div className="metric-data">
            <span className="kicker">Today PnL</span>
            <strong className="mono positive">+$184.20</strong>
          </div>
        </article>
        <article className="panel metric">
          <div className="metric-data">
            <span className="kicker">Open risk</span>
            <strong className="mono">1.0%<small>of 3.0% limit</small></strong>
          </div>
        </article>
        <article className="panel metric">
          <div className="metric-data">
            <span className="kicker">Win rate · 7D</span>
            <strong className="mono">61%</strong>
          </div>
        </article>
      </section>

      {query.error ? <p className="notice error">{query.error}</p> : null}
      {query.queued ? <p className="notice success">Signal queued for execution.</p> : null}

      <section className="trade-workspace">
        <div className="panel chat-panel">
          <div className="chat-scroll">
            {messages.length ? (
              messages.map((message) => (
                <article className={`message ${message.role}`} key={message.id}>
                  <small>{message.kind.replaceAll("_", " ")}</small>
                  <p>{message.content}</p>
                </article>
              ))
            ) : (
              <div style={{ margin: "auto", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "40px 20px" }}>
                <VexqoraLogo size={42} />
                <h2>Ultraviolet Signal Desk</h2>
                <p style={{ color: "var(--muted)", maxWidth: "420px", fontSize: "14px", lineHeight: "1.6" }}>
                  Paste or type a trading signal below to parse entry, stop loss, take profits and risk calculation before execution.
                </p>
                <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                  <div className="ev"><span className="ev-dot" style={{ background: "var(--violet)" }} /> Deterministic parser</div>
                  <div className="ev"><span className="ev-dot" style={{ background: "var(--aqua)" }} /> Exchange-hosted SL/TP</div>
                </div>
              </div>
            )}
          </div>
          {account ? <SignalComposer /> : <p className="notice error" style={{ marginTop: "auto" }}>Connect an exchange account in Accounts tab before executing trades.</p>}
        </div>

        <aside className="panel active-trade">
          <div className="active-title">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <strong>BTCUSDT</strong>
              <span className="badge long">LONG 5x</span>
            </div>
            <span className="badge demo">Ready</span>
          </div>
          <div className="pnl mono">+$184.20</div>
          
          <span className="kicker" style={{ marginTop: "8px" }}>Levels</span>
          <div className="level"><span className="positive">TP3</span><span className="mono">68,500.0</span></div>
          <div className="level"><span className="positive">TP2</span><span className="mono">67,000.0</span></div>
          <div className="level muted"><span className="positive">TP1 ✓</span><span className="mono">66,000.0</span></div>
          <div className="level"><span className="demo-text">Entry</span><span className="mono">65,002.5</span></div>
          <div className="level"><span className="negative">SL · BE</span><span className="mono">65,002.5</span></div>
          <div className="level"><span className="warning">Trail 1%</span><span className="mono">active</span></div>

          <div className="trade-controls">
            <button className="button secondary">Close 50%</button>
            <button className="button secondary">Move SL to BE</button>
            <button className="button danger">Close all positions</button>
          </div>
        </aside>
      </section>
    </div>
  );
}
