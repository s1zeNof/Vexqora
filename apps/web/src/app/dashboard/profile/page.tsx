import type { ProfileRow, RiskSettingsRow, TradeRow } from "@crypto-bot/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { VexqoraLogo } from "../../../components/logo";
import { formatCryptoPrice } from "../../../lib/format";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { signOut } from "../../login/actions";
import { addPaperDepositAction, updateProfile } from "../actions";

const profileAccountSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  exchange: z.enum(["paper", "bybit", "binance"]),
  environment: z.enum(["live", "demo"]),
  paper_balance: z.coerce.number().nullable()
});

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ saved?: string; depositAdded?: string; error?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const query = (await searchParams) ?? {};

  // Fetch profile, active account, risk settings, and trades
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

  const [riskRes, tradesRes] = await Promise.all([
    activeAccount
      ? supabase.from("risk_settings").select("*").eq("account_id", activeAccount.id).maybeSingle()
      : { data: null },
    activeAccount
      ? supabase.from("trades").select("*").eq("account_id", activeAccount.id).order("opened_at", { ascending: false }).limit(100)
      : { data: [] }
  ]);

  const riskSettings = riskRes.data as RiskSettingsRow | null;
  const trades = (tradesRes.data ?? []) as TradeRow[];

  // Comprehensive analytics calculation
  const totalTrades = trades.length;
  const openTrades = trades.filter(t => t.status === "active" || t.status === "entry_open");
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

  const bestTrade = winningTrades.length > 0 ? Math.max(...winningTrades.map(t => Number(t.realized_pnl))).toFixed(2) : "0.00";
  const worstTrade = losingTrades.length > 0 ? Math.min(...losingTrades.map(t => Number(t.realized_pnl))).toFixed(2) : "0.00";

  // Long vs Short breakdown
  const longTrades = closedTrades.filter(t => t.side === "long");
  const shortTrades = closedTrades.filter(t => t.side === "short");
  const longWins = longTrades.filter(t => Number(t.realized_pnl) > 0);
  const shortWins = shortTrades.filter(t => Number(t.realized_pnl) > 0);

  const longWinRate = longTrades.length > 0 ? ((longWins.length / longTrades.length) * 100).toFixed(0) : "—";
  const shortWinRate = shortTrades.length > 0 ? ((shortWins.length / shortTrades.length) * 100).toFixed(0) : "—";
  const longPct = closedTrades.length > 0 ? (longTrades.length / closedTrades.length) * 100 : 50;

  const displayName = profile?.display_name ?? user.email?.split("@")[0] ?? "Trader";
  const avatarLetter = displayName.charAt(0).toUpperCase();

  const currentEquity = activeAccount?.exchange === "paper"
    ? Number(activeAccount.paper_balance ?? 10000)
    : null;

  return (
    <div className="profile-container">
      <div>
        <span className="eyebrow">Institutional Trader Hub</span>
        <h1 style={{ marginTop: "6px" }}>Performance & Trader Profile</h1>
        <p className="lead">Детальна статистика угод, Win Rate, Risk:Reward, баланс депозиту та налаштування бота.</p>
      </div>

      {query.saved ? <p className="notice success">✓ Профіль успішно оновлено.</p> : null}
      {query.depositAdded ? <p className="notice success">✓ Тестовий депозит +10,000 USDT успішно нараховано на Paper рахунок!</p> : null}
      {query.error ? <p className="notice error">{query.error}</p> : null}

      {/* Hero Card: Trader Identity & Balance */}
      <div className="profile-hero">
        <div className="profile-user-left">
          <div className="profile-avatar">{avatarLetter}</div>
          <div className="profile-meta-info">
            <div className="profile-name-row">
              <h2 style={{ margin: 0, fontSize: "22px" }}>{displayName}</h2>
              <span className={`badge ${activeAccount?.exchange === "paper" ? "demo" : activeAccount?.environment === "live" ? "live" : "demo"}`}>
                {activeAccount?.exchange === "paper" ? "Paper Operator" : activeAccount ? `${activeAccount.exchange.toUpperCase()} ${activeAccount.environment.toUpperCase()}` : "No Account"}
              </span>
            </div>
            <span style={{ fontSize: "13px", color: "var(--muted)" }}>{user.email}</span>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" }}>
              <span className="ai-score-badge" style={{ fontSize: "11px" }}>★ Institutional Trader</span>
              <span className="kicker" style={{ fontSize: "10px" }}>З нами з {new Date(profile?.created_at || user.created_at).toLocaleDateString("uk-UA")}</span>
            </div>
          </div>
        </div>

        {/* Deposit & Wallet Overview */}
        <div className="profile-deposit-box">
          <span className="kicker" style={{ color: "var(--soft-violet)" }}>
            {activeAccount?.exchange === "paper" ? "Віртуальний депозит (Paper Equity)" : "Active Trading Equity"}
          </span>
          <div className="mono" style={{ fontSize: "26px", fontWeight: "700", color: "var(--aqua)" }}>
            {currentEquity !== null
              ? `${currentEquity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
              : "Bybit Connected"}
          </div>
          {activeAccount?.exchange === "paper" ? (
            <form action={addPaperDepositAction} style={{ marginTop: "4px" }}>
              <input type="hidden" name="accountId" value={activeAccount.id} />
              <input type="hidden" name="amount" value="10000" />
              <button
                type="submit"
                className="button primary"
                style={{ width: "100%", minHeight: "32px", fontSize: "12px", padding: "0 10px" }}
              >
                + 10,000 USDT Тестовий Депозит
              </button>
            </form>
          ) : (
            <Link
              href="/dashboard/accounts"
              className="button secondary"
              style={{ minHeight: "32px", fontSize: "12px" }}
            >
              Керування рахунками
            </Link>
          )}
        </div>
      </div>

      {/* Real-time Trading Metrics Grid */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3>Статистика торгівлі та результативність</h3>
          <span className="mono" style={{ fontSize: "12px", color: "var(--muted)" }}>
            Усього угод: {totalTrades} ({openTrades.length} відкритих · {closedTrades.length} закритих)
          </span>
        </div>

        <div className="profile-stats-grid">
          {/* Win Rate */}
          <div className="profile-stat-card">
            <div className="stat-label-wrap">
              <span className="kicker">Win Rate</span>
              <span className="ai-pulse-dot" style={{ background: "var(--aqua)" }} />
            </div>
            <div className={`stat-value mono ${winRatePct && Number(winRatePct) >= 50 ? "positive" : "negative"}`}>
              {winRatePct !== null ? `${winRatePct}%` : "—"}
            </div>
            <span className="stat-subtext">
              {winningTrades.length} прибуткових · {losingTrades.length} збиткових
            </span>
          </div>

          {/* Realized PnL */}
          <div className="profile-stat-card">
            <div className="stat-label-wrap">
              <span className="kicker">Реалізований PnL</span>
              <span className="mono" style={{ fontSize: "11px", color: "var(--muted)" }}>Total Net</span>
            </div>
            <div className={`stat-value mono ${totalRealizedPnl >= 0 ? "positive" : "negative"}`}>
              {totalRealizedPnl >= 0 ? "+" : ""}${totalRealizedPnl.toFixed(2)} USDT
            </div>
            <span className="stat-subtext">
              {grossProfit > 0 ? `+$${grossProfit.toFixed(2)}` : "$0"} Win / -${grossLoss.toFixed(2)} Loss
            </span>
          </div>

          {/* Profit Factor */}
          <div className="profile-stat-card">
            <div className="stat-label-wrap">
              <span className="kicker">Profit Factor</span>
              <span className="memory-badge" style={{ fontSize: "10px", padding: "1px 6px" }}>R:R Ratio</span>
            </div>
            <div className="stat-value mono" style={{ color: "var(--text)" }}>
              {profitFactor}
            </div>
            <span className="stat-subtext">
              Співвідношення валового прибутку до збитку
            </span>
          </div>

          {/* Average Trade Win / Loss */}
          <div className="profile-stat-card">
            <div className="stat-label-wrap">
              <span className="kicker">Середній Win / Loss</span>
            </div>
            <div className="stat-value mono" style={{ fontSize: "18px", marginTop: "2px" }}>
              <span className="positive">+${avgWin}</span> / <span className="negative">-${avgLoss}</span>
            </div>
            <span className="stat-subtext">
              Best: +${bestTrade} · Worst: -${Math.abs(Number(worstTrade)).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Split Cards: Trading Bias & Bot Risk Settings */}
      <div className="profile-split-grid">
        {/* Bias Breakdown (Long vs Short) */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>Розподіл напрямків (Long vs Short)</h3>
            <span className="badge demo">{closedTrades.length} угод</span>
          </div>
          <p style={{ fontSize: "13px", marginTop: "4px" }}>
            Баланс та вінрейт по напрямках торгових позицій:
          </p>

          <div className="bias-bar-wrap">
            <div className="bias-bar-long" style={{ width: `${longPct}%` }} title={`Long: ${longPct.toFixed(0)}%`} />
            <div className="bias-bar-short" style={{ width: `${100 - longPct}%` }} title={`Short: ${(100 - longPct).toFixed(0)}%`} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "12px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="badge long" style={{ fontSize: "10px" }}>LONG</span>
                <strong className="mono">{longTrades.length} угод</strong>
              </div>
              <div className="mono positive" style={{ fontSize: "12px", marginTop: "4px" }}>
                Вінрейт: {longWinRate}% ({longWins.length}W)
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", justifyContent: "flex-end" }}>
                <strong className="mono">{shortTrades.length} угод</strong>
                <span className="badge short" style={{ fontSize: "10px" }}>SHORT</span>
              </div>
              <div className="mono negative" style={{ fontSize: "12px", marginTop: "4px" }}>
                Вінрейт: {shortWinRate}% ({shortWins.length}W)
              </div>
            </div>
          </div>
        </div>

        {/* Strategy & Bot Risk Engine */}
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>Параметри бота та Ризик-контроль</h3>
            <span className={`badge ${riskSettings?.kill_switch ? "short" : "active"}`}>
              {riskSettings?.kill_switch ? "KILL SWITCH ACTIVE" : "ENGINE SECURE"}
            </span>
          </div>
          <p style={{ fontSize: "13px", marginTop: "4px" }}>
            Активні обмеження на відкриття позицій та кредитного плеча:
          </p>

          <div className="ai-setup-grid" style={{ marginTop: "12px", marginBottom: "14px" }}>
            <div className="ai-setup-item">
              <span>Ризик на угоду</span>
              <strong className="mono">{riskSettings?.risk_per_trade_pct ?? 1.0}%</strong>
            </div>
            <div className="ai-setup-item">
              <span>Макс. плече</span>
              <strong className="mono">{riskSettings?.max_leverage ?? 5}x</strong>
            </div>
            <div className="ai-setup-item">
              <span>Макс. позицій</span>
              <strong className="mono">{riskSettings?.max_open_positions ?? 3}</strong>
            </div>
            <div className="ai-setup-item">
              <span>Денний ліміт</span>
              <strong className="mono">{riskSettings?.max_daily_loss_pct ?? 5.0}%</strong>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Link
              href="/dashboard/risk"
              className="button secondary"
              style={{ minHeight: "32px", fontSize: "12px" }}
            >
              ⚙️ Налаштувати ризик-менеджмент
            </Link>
          </div>
        </div>
      </div>

      {/* Recent Executed Trades Journal */}
      <div className="card" style={{ padding: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
          <div>
            <h3>Журнал останніх угод</h3>
            <p style={{ fontSize: "13px", margin: 0 }}>Історія виконаних позицій, цін входу та реалізованого прибутку.</p>
          </div>
          <Link href="/dashboard/history" className="button secondary" style={{ minHeight: "30px", fontSize: "12px" }}>
            Вся історія →
          </Link>
        </div>

        {trades.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Символ</th>
                  <th>Напрямок</th>
                  <th>Вхід</th>
                  <th>Розмір</th>
                  <th>Статус</th>
                  <th>PnL</th>
                </tr>
              </thead>
              <tbody>
                {trades.slice(0, 10).map((t) => (
                  <tr key={t.id}>
                    <td className="mono" style={{ color: "var(--muted)", fontSize: "12px" }}>
                      {new Date(t.opened_at || Date.now()).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td><strong>{t.symbol}</strong></td>
                    <td>
                      <span className={`badge ${t.side}`}>{t.side.toUpperCase()} {t.leverage}x</span>
                    </td>
                    <td className="mono">${formatCryptoPrice(Number(t.entry_avg))}</td>
                    <td className="mono">{t.qty}</td>
                    <td>
                      <span className={`badge ${t.status === "active" ? "active" : "demo"}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className={`mono ${Number(t.realized_pnl) >= 0 ? "positive" : "negative"}`} style={{ fontWeight: "700" }}>
                      {t.realized_pnl != null
                        ? `${Number(t.realized_pnl) >= 0 ? "+" : ""}$${Number(t.realized_pnl).toFixed(2)}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "36px 16px", color: "var(--muted)" }}>
            <VexqoraLogo size={36} />
            <p style={{ fontSize: "14px", fontWeight: "600", color: "var(--text)", marginTop: "10px" }}>
              Ще немає зафіксованих угод
            </p>
            <p style={{ fontSize: "12px", marginTop: "4px" }}>
              Перейдіть у вкладку Сигнали або Vexqora Pulse та натисніть «Виконати», щоб увійти в тестову позицію.
            </p>
            <Link href="/dashboard/chat" className="button primary" style={{ minHeight: "34px", marginTop: "12px", fontSize: "12px" }}>
              ⚡ Перейти до сигналів
            </Link>
          </div>
        )}
      </div>

      {/* Account Settings & Security */}
      <div className="card">
        <h3>Налаштування акаунту та безпека</h3>
        <div style={{ display: "grid", gap: "16px", marginTop: "16px" }}>
          <form action={updateProfile} className="form-group">
            <label>Ім&apos;я користувача (Display Name)</label>
            <div style={{ display: "flex", gap: "8px", maxWidth: "420px" }}>
              <input name="displayName" defaultValue={displayName} maxLength={80} required />
              <button className="button primary" type="submit">Зберегти</button>
            </div>
          </form>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
            <div>
              <div className="kicker">Email</div>
              <div style={{ fontSize: "14px", fontWeight: "600", marginTop: "4px" }}>{user.email}</div>
            </div>
            <div>
              <div className="kicker">Автентифікація</div>
              <div style={{ marginTop: "4px" }}>
                <span className="badge" style={{ background: "#4285f422", color: "#4285f4", border: "1px solid #4285f444" }}>
                  {user.app_metadata?.provider ? `${String(user.app_metadata.provider).toUpperCase()}` : "Email / Password"}
                </span>
              </div>
            </div>
            <div>
              <div className="kicker">User ID</div>
              <div className="mono" style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px" }}>{user.id}</div>
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--line)", paddingTop: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "13px", color: "var(--muted)" }}>
              Завершити активну сесію на цьому пристрої:
            </span>
            <form action={signOut}>
              <button className="button danger" type="submit" style={{ minHeight: "34px", fontSize: "12px" }}>
                Вийти з Vexqora
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
