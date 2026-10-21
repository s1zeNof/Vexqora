import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { VexqoraLogo } from "../components/logo";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const params = await searchParams;
  let user = null;

  try {
    const supabase = await createSupabaseServerClient();

    if (params.code) {
      const { error } = await supabase.auth.exchangeCodeForSession(params.code);
      if (!error) {
        redirect("/dashboard/chat");
      }
    }

    const { data } = await supabase.auth.getUser();
    user = data?.user ?? null;
  } catch (error) {
    if ((error as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) {
      throw error;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", width: "100%" }}>
      {/* Top Header */}
      <header className="landing-nav">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <VexqoraLogo size={28} />
          <span style={{ fontSize: "18px", fontWeight: "700", letterSpacing: "-0.01em" }}>Vexqora Trade</span>
          <span className="badge demo" style={{ marginLeft: "6px" }}>V5 Perpetual</span>
        </div>

        <nav className="landing-nav-links">
          <a href="#features">Features</a>
          <a href="#terminal">Terminal Desk</a>
          <a href="#risk">Risk Architecture</a>
          <a href="#bybit">Bybit Integration</a>
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {user ? (
            <>
              <span className="mono" style={{ fontSize: "13px", color: "var(--muted)" }}>{user.email}</span>
              <Link href="/dashboard/chat" className="button primary">
                Enter Terminal →
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="button secondary">Sign in</Link>
              <Link href="/login" className="button primary">Launch Platform</Link>
            </>
          )}
        </div>
      </header>

      {/* Live Market Ticker */}
      <div className="ticker-bar">
        <div className="ticker-item"><span className="mono" style={{ color: "var(--muted)" }}>BTCUSDT</span><span className="mono positive">65,420.50 +1.84%</span></div>
        <div className="ticker-item"><span className="mono" style={{ color: "var(--muted)" }}>ETHUSDT</span><span className="mono positive">3,412.80 +2.15%</span></div>
        <div className="ticker-item"><span className="mono" style={{ color: "var(--muted)" }}>SOLUSDT</span><span className="mono positive">184.20 +4.60%</span></div>
        <div className="ticker-item"><span className="mono" style={{ color: "var(--muted)" }}>BNBUSDT</span><span className="mono positive">592.10 +0.92%</span></div>
        <div className="ticker-item" style={{ marginLeft: "auto" }}><span className="status-dot" /><span style={{ color: "var(--muted)", fontSize: "11px" }}>BYBIT V5 LIVE/DEMO READY</span></div>
      </div>

      {/* Hero Section */}
      <section className="hero-section">
        <div className="kicker" style={{ color: "var(--soft-violet)" }}>Intelligent Trade Execution Platform</div>
        <h1 style={{ maxWidth: "900px" }}>
          Ultraviolet terminal. <br />
          <span style={{ background: "linear-gradient(90deg, #B9A2FF, #35F2D0)", WebkitBackgroundClip: "text", color: "transparent" }}>
            Quiet surfaces, sharp signals.
          </span>
        </h1>
        <p className="lead" style={{ maxWidth: "720px" }}>
          Paste raw text signals from Telegram or Discord. Preview calculated risk, weighted R:R and normalized quantities, then execute on Bybit linear perpetuals with exchange-hosted stop protection.
        </p>

        <div className="hero-cta">
          <Link href={user ? "/dashboard/chat" : "/login"} className="button primary" style={{ minHeight: "48px", padding: "0 28px", fontSize: "15px" }}>
            {user ? "Open Signals Desk →" : "Start with Google or Email →"}
          </Link>
          <Link href="/login" className="button secondary" style={{ minHeight: "48px", padding: "0 24px", fontSize: "15px" }}>
            Explore Demo Trading
          </Link>
        </div>
      </section>

      {/* Interactive Terminal Showcase Preview */}
      <section id="terminal" style={{ width: "100%", maxWidth: "1280px", margin: "0 auto", padding: "0 24px" }}>
        <div className="panel" style={{ padding: "0", overflow: "hidden", border: "1px solid var(--line)" }}>
          <div style={{ height: "46px", background: "#0e0b1acc", borderBottom: "1px solid var(--line)", padding: "0 18px", display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#ff4f9a" }} />
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#ffc24b" }} />
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#35f2d0" }} />
            <span className="mono" style={{ fontSize: "12px", color: "var(--muted)", marginLeft: "12px" }}>vexqora.terminal.desk · BTCUSDT USDT-Perpetual</span>
          </div>

          <div style={{ padding: "20px", display: "grid", gridTemplateColumns: "1fr 320px", gap: "16px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="message user" style={{ alignSelf: "flex-end" }}>
                <p>BTCUSDT LONG<br />entry 65000<br />tp 66000 40%, 67000 30%, 68500 30%<br />sl 64000 · trail 1% after tp1<br />lev 5 · risk 1%</p>
              </div>
              <div className="preview-card" style={{ maxWidth: "460px" }}>
                <div className="preview-heading">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span className="badge long">LONG</span>
                    <strong>BTCUSDT preview</strong>
                  </div>
                  <span className="kicker">Ready to confirm</span>
                </div>
                <dl>
                  <div><dt>Quantity</dt><dd>0.231 BTC</dd></div>
                  <div><dt>Risk Amount</dt><dd>$100.00 (1.0%)</dd></div>
                  <div><dt>Weighted R:R</dt><dd>1 : 2.40</dd></div>
                </dl>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button className="button primary" style={{ minHeight: "36px", fontSize: "12px" }}>Confirm signal</button>
                  <button className="button secondary" style={{ minHeight: "36px", fontSize: "12px" }}>Cancel</button>
                </div>
              </div>
              <div className="ev"><span className="ev-dot" style={{ background: "var(--aqua)" }} /> Entry filled at 65,002.5 · Position protected with exchange-hosted SL</div>
              <div className="ev"><span className="ev-dot" style={{ background: "var(--aqua)" }} /> TP1 hit at 66,000 · +$92.40 · SL moved to breakeven</div>
            </div>

            <div className="panel" style={{ padding: "16px", background: "var(--plum)", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>BTCUSDT</strong>
                <span className="badge long">LONG 5x</span>
              </div>
              <div className="pnl mono">+$184.20</div>
              <span className="kicker">Target Levels</span>
              <div className="level"><span className="positive">TP3</span><span>68,500.0</span></div>
              <div className="level"><span className="positive">TP2</span><span>67,000.0</span></div>
              <div className="level muted"><span className="positive">TP1 ✓</span><span>66,000.0</span></div>
              <div className="level"><span className="demo-text">Entry</span><span>65,002.5</span></div>
              <div className="level"><span className="negative">SL · BE</span><span>65,002.5</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* 3 Core Pillars */}
      <section id="features" className="feature-grid-full">
        <article className="card">
          <div className="kicker" style={{ color: "var(--aqua)" }}>01 · Zero Guesswork</div>
          <h2 style={{ margin: "8px 0" }}>Deterministic Signal Parsing</h2>
          <p>
            No LLMs making execution decisions. Every signal is parsed via formal grammar and validated with strict Zod schemas against Bybit tickSize and qtyStep filters.
          </p>
        </article>

        <article className="card">
          <div className="kicker" style={{ color: "var(--violet)" }}>02 · Survival Guarantee</div>
          <h2 style={{ margin: "8px 0" }}>Exchange-Hosted Stops</h2>
          <p>
            Stop Loss and Take Profit orders live directly in Bybit order book via Trading Stop and Reduce-Only targets. Your position remains protected even if the worker restarts.
          </p>
        </article>

        <article className="card">
          <div className="kicker" style={{ color: "var(--amber)" }}>03 · One Engine</div>
          <h2 style={{ margin: "8px 0" }}>Identical Demo & Live Code</h2>
          <p>
            Demo and Live accounts share the exact same sizing math, risk limits and execution primitives. The environment exists only in exchange account credentials.
          </p>
        </article>
      </section>

      {/* Footer */}
      <footer style={{ marginTop: "auto", borderTop: "1px solid var(--line)", padding: "32px 40px", display: "flex", justifyContent: "space-between", alignItems: "center", color: "var(--muted)", fontSize: "13px" }}>
        <div>Vexqora Trade · Intelligent Trade Execution Platform</div>
        <div style={{ display: "flex", gap: "20px" }}>
          <Link href="/dashboard/chat">Terminal</Link>
          <Link href="/dashboard/accounts">Accounts</Link>
          <Link href="/dashboard/risk">Risk Rules</Link>
          <Link href="/login">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
