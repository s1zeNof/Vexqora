"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatCryptoPrice } from "../../../../lib/format";
import { setBotStatus, triggerBotScan, closeTradeManually, updateBotSettings } from "../actions";

export type BotStatus = "running" | "stopped" | "paused" | "error";

export interface BotDecisionItem {
  id: number;
  cycle_id: string;
  action: "enter" | "wait" | "manage" | "exit" | "blocked";
  symbol: string | null;
  reasoning: string;
  evidence: Record<string, unknown>;
  created_at: string;
}

export interface RadarTickerItem {
  symbol: string;
  name: string;
  lastPrice: number;
  priceFormatted: string;
  change24h: number;
  changeFormatted: string;
  turnoverFormatted: string;
  regime: string;
  volumeState: string;
  status: string;
}

export interface TradeTargetItem {
  idx: number;
  price: number;
  share_pct: number;
  status: string;
}

export interface OpenTradeItem {
  id: string;
  symbol: string;
  side: "long" | "short";
  status: string;
  entry_avg: number | null;
  qty: number | null;
  leverage: number | null;
  sl: number | null;
  realized_pnl: number | null;
  created_at: string;
  targets?: TradeTargetItem[];
}

export interface ClosedTradeItem {
  id: string;
  symbol: string;
  side: "long" | "short";
  status: string;
  entry_avg: number | null;
  exit_price: number | null;
  exit_reason: string | null;
  qty: number | null;
  leverage: number | null;
  sl: number | null;
  realized_pnl: number | null;
  opened_at: string | null;
  closed_at: string | null;
  targets?: TradeTargetItem[];
}

interface BotDetailViewProps {
  bot: {
    id: string;
    name: string;
    description: string | null;
    status: BotStatus;
    mode: string;
    strategy: string;
    allocated_capital: number;
    current_balance: number;
    target_balance: number | null;
    direction?: string;
    risk_per_trade_pct: number;
    max_daily_loss_pct: number;
    goal_action: string;
    last_heartbeat_at: string | null;
    last_error: string | null;
    created_at: string;
  };
  decisions: BotDecisionItem[];
  openPositions: OpenTradeItem[];
  closedTrades: ClosedTradeItem[];
}

export function BotDetailView({
  bot,
  decisions,
  openPositions,
  closedTrades,
}: BotDetailViewProps) {
  const [activeTab, setActiveTab] = useState<"radar" | "active" | "archive" | "decisions" | "config">("radar");
  const [now, setNow] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [radarData, setRadarData] = useState<RadarTickerItem[]>([]);
  const [isRadarLoading, setIsRadarLoading] = useState(true);
  const [radarCategory, setRadarCategory] = useState<"volume" | "gainers" | "losers" | "volatility">("volume");
  const [radarSearch, setRadarSearch] = useState("");
  const [totalPairs, setTotalPairs] = useState(0);

  useEffect(() => {
    setIsMounted(true);
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    async function loadRadar() {
      if (activeTab !== "radar" || (typeof document !== "undefined" && document.hidden)) return;
      try {
        const query = new URLSearchParams({
          category: radarCategory,
          limit: "40",
          ...(radarSearch ? { search: radarSearch } : {}),
        });
        const res = await fetch(`/api/market/radar?${query.toString()}`);
        if (res.ok) {
          const data = (await res.json()) as { tickers?: RadarTickerItem[]; totalPairs?: number };
          if (active && data.tickers) {
            setRadarData(data.tickers);
            if (data.totalPairs) setTotalPairs(data.totalPairs);
            setIsRadarLoading(false);
          }
        }
      } catch {
        // preserve previous radar state on error
      }
    }
    void loadRadar();
    const interval = setInterval(() => {
      void loadRadar();
    }, 6000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [radarCategory, radarSearch, activeTab]);

  const heartbeatTime = bot.last_heartbeat_at ? new Date(bot.last_heartbeat_at).getTime() : 0;
  const secondsSinceHeartbeat = isMounted && heartbeatTime > 0 && now > 0 ? Math.max(0, Math.floor((now - heartbeatTime) / 1000)) : null;

  const allocated = Number(bot.allocated_capital);
  const realizedPnl = closedTrades.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0);
  const totalTradesCount = closedTrades.length;
  const winningTrades = closedTrades.filter((t) => Number(t.realized_pnl ?? 0) > 0).length;
  const winRate = totalTradesCount > 0 ? (winningTrades / totalTradesCount) * 100 : null;

  // Use actual audited performance based on this bot's closed trades
  const balance = totalTradesCount > 0 ? Math.max(0, allocated + realizedPnl) : Number(bot.current_balance);
  const pnl = balance - allocated;
  const pnlPct = allocated > 0 ? (pnl / allocated) * 100 : 0;
  const pnlColor = pnl > 0 ? "#00e676" : pnl < 0 ? "#ef4444" : "#94a3b8";

  const target = bot.target_balance ? Number(bot.target_balance) : null;
  const targetPct = target && target > allocated ? Math.min(100, Math.max(0, ((balance - allocated) / (target - allocated)) * 100)) : null;

  const latestDecision = decisions[0];

  return (
    <div className="bot-detail-root">
      {/* Top Breadcrumb & Quick Info */}
      <div className="bot-detail-topbar">
        <Link href="/dashboard/bots" className="bot-detail-back-link">
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, flexShrink: 0 }}>
            <path d="M10 12L6 8l4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>All Trading Bots</span>
        </Link>
        <div className="bot-detail-environment-badge">
          <span className="dot-cyan" />
          <span>Vexqora Paper Engine · Real Market Feed</span>
        </div>
      </div>

      {/* Main Live Engine Command Header */}
      <header className="bot-engine-header">
        <div className="bot-engine-header__left">
          <div className="bot-engine-identity">
            <div className={`bot-pulse-radar bot-pulse-radar--${bot.status}`}>
              <span className="bot-pulse-radar__core" />
              <span className="bot-pulse-radar__wave" />
            </div>
            <div>
              <div className="bot-engine-title-row">
                <h1>{bot.name}</h1>
                <span className="badge-tag badge-tag--paper">{bot.mode.toUpperCase()}</span>
                <span className={`badge-tag badge-tag--${bot.status}`}>{bot.status.toUpperCase()}</span>
                <span className="badge-tag badge-tag--strategy">{bot.strategy.toUpperCase()}</span>
              </div>
              <p className="bot-engine-desc">
                {bot.description || "24/7 Autonomous Market-Adaptive AI Trading Agent"}
              </p>
            </div>
          </div>
        </div>

        <div className="bot-engine-header__right">
          {/* Heartbeat Status Indicator */}
          <div className="bot-heartbeat-box">
            <div className="bot-heartbeat-status">
              <span className={isMounted && secondsSinceHeartbeat !== null && secondsSinceHeartbeat < 60 ? "beacon-active" : bot.status === "running" ? "beacon-stalled" : "beacon-idle"} />
              <strong>
                {bot.status === "running"
                  ? isMounted && secondsSinceHeartbeat !== null && secondsSinceHeartbeat < 60
                    ? "RUNNER ACTIVE"
                    : "RUNNER IDLE"
                  : bot.status.toUpperCase()}
              </strong>
            </div>
            <span className="bot-heartbeat-timer mono" suppressHydrationWarning>
              {!isMounted
                ? "Checking pulse..."
                : secondsSinceHeartbeat !== null
                  ? secondsSinceHeartbeat < 60
                    ? `Pulse: ${secondsSinceHeartbeat}s ago`
                    : `Pulse: ${Math.floor(secondsSinceHeartbeat / 60)}m ago`
                  : "Waiting for start"}
            </span>
          </div>

          {/* Quick Actions: Force Scan & Controls */}
          <div className="bot-controls-group">
            <form action={triggerBotScan} onSubmit={() => setIsPending(true)} className="inline-form">
              <input type="hidden" name="id" value={bot.id} />
              <button
                type="submit"
                disabled={isPending}
                className="btn-terminal btn-terminal--scan"
                title="Force a real-time Bybit market scan cycle now"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className={isPending ? "spin-icon" : ""}>
                  <path d="M13 3l-3 3M10 3h3v3M3 8a5 5 0 018.5-3.5L13 6M3 13l3-3M6 13H3v-3M13 8a5 5 0 01-8.5 3.5L3 10" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{isPending ? "Analyzing..." : "⚡ Scan Market Now"}</span>
              </button>
            </form>

            <form action={setBotStatus} className="inline-form">
              <input type="hidden" name="id" value={bot.id} />
              {bot.status !== "running" && (
                <button
                  type="submit"
                  name="intent"
                  value="start"
                  className="btn-terminal btn-terminal--start"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <path d="M4 3l9 5-9 5V3z" />
                  </svg>
                  <span>Start Bot</span>
                </button>
              )}
              {bot.status === "running" && (
                <button
                  type="submit"
                  name="intent"
                  value="pause"
                  className="btn-terminal btn-terminal--pause"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <path d="M4.5 3h2v10h-2V3zm5 0h2v10h-2V3z" />
                  </svg>
                  <span>Pause</span>
                </button>
              )}
              <button
                type="submit"
                name="intent"
                value="stop"
                className="btn-terminal btn-terminal--stop"
              >
                <svg viewBox="0 0 16 16" fill="currentColor">
                  <rect x="3" y="3" width="10" height="10" rx="1.5" />
                </svg>
                <span>Emergency Stop</span>
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Warning Banner if runner is idle */}
      {bot.status === "running" && (secondsSinceHeartbeat === null || secondsSinceHeartbeat >= 60) && (
        <div className="bot-alert-banner bot-alert-banner--warning">
          <svg
            width={20}
            height={20}
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="bot-alert-banner__icon"
            style={{ width: 20, height: 20, minWidth: 20, minHeight: 20, flexShrink: 0 }}
          >
            <circle cx="10" cy="10" r="8" />
            <line x1="10" y1="6" x2="10" y2="10" strokeLinecap="round" />
            <line x1="10" y1="14" x2="10.01" y2="14" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <div>
            <strong>Фоновий воркер очікує підключення:</strong> Останній пульс зафіксовано {secondsSinceHeartbeat ? `${Math.floor(secondsSinceHeartbeat / 60)} хв тому` : "раніше"}. Натисніть кнопку <strong>«⚡ Scan Market Now»</strong> для примусового ринкового сканування або запустіть воркер у терміналі (<code>npm run dev:worker</code>).
          </div>
        </div>
      )}

      {/* Error Banner if any */}
      {bot.status === "error" && bot.last_error && (
        <div className="bot-alert-banner">
          <svg
            width={20}
            height={20}
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="bot-alert-banner__icon"
            style={{ width: 20, height: 20, minWidth: 20, minHeight: 20, flexShrink: 0 }}
          >
            <circle cx="10" cy="10" r="8" />
            <line x1="10" y1="6" x2="10" y2="10" strokeLinecap="round" />
            <line x1="10" y1="14" x2="10.01" y2="14" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <div>
            <strong>Bot Runner Error:</strong> {bot.last_error}
          </div>
        </div>
      )}

      {/* 6 Full-Width High-Performance Metrics Cards */}
      <section className="bot-metrics-row">
        <div className="metric-tile">
          <span className="metric-tile__label">Allocated Capital</span>
          <strong className="metric-tile__value mono">${allocated.toFixed(2)}</strong>
          <span className="metric-tile__sub">Virtual Paper USDT</span>
        </div>

        <div className="metric-tile">
          <span className="metric-tile__label">Current Balance</span>
          <strong className="metric-tile__value mono" style={{ color: "#00e5ff" }}>
            ${balance.toFixed(2)}
          </strong>
          <span className="metric-tile__sub">Active equity</span>
        </div>

        <div className="metric-tile">
          <span className="metric-tile__label">Net PnL</span>
          <strong className="metric-tile__value mono" style={{ color: pnlColor }}>
            {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
          </strong>
          <span className="metric-tile__sub">Overall performance</span>
        </div>

        <div className="metric-tile">
          <span className="metric-tile__label">Win Rate</span>
          {winRate !== null ? (
            <>
              <strong className="metric-tile__value mono">
                {winRate.toFixed(1)}%
              </strong>
              <span className="metric-tile__sub">{winningTrades}W / {totalTradesCount} total</span>
            </>
          ) : (
            <>
              <strong className="metric-tile__value mono text-muted">—</strong>
              <span className="metric-tile__sub">No closed trades yet</span>
            </>
          )}
        </div>

        <div className="metric-tile">
          <span className="metric-tile__label">Open Positions</span>
          <strong className="metric-tile__value mono" style={{ color: openPositions.length > 0 ? "#00e5ff" : "#94a3b8" }}>
            {openPositions.length} Active
          </strong>
          <span className="metric-tile__sub">Market exposure</span>
        </div>

        <div className="metric-tile">
          <span className="metric-tile__label">Target Goal</span>
          <strong className="metric-tile__value mono">
            {target ? `$${target.toFixed(2)}` : "None"}
          </strong>
          {targetPct !== null ? (
            <div className="metric-progress-wrap">
              <div className="metric-progress-bar" style={{ width: `${targetPct}%` }} />
              <span className="metric-progress-text mono">{targetPct.toFixed(0)}% reached</span>
            </div>
          ) : (
            <span className="metric-tile__sub">Continuous trading</span>
          )}
        </div>
      </section>

      {/* Professional Full-Width Navigation Tabs */}
      <nav className="bot-nav-tabs">
        <button
          type="button"
          onClick={() => setActiveTab("radar")}
          className={`bot-nav-tab ${activeTab === "radar" ? "is-active" : ""}`}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="8" cy="8" r="6" />
            <circle cx="8" cy="8" r="2" />
            <path d="M8 2v4M8 10v4M2 8h4M10 8h4" />
          </svg>
          <span>Live AI Thoughts &amp; Radar</span>
          <span className="tab-pill">Real-time</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("active")}
          className={`bot-nav-tab ${activeTab === "active" ? "is-active" : ""}`}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M2 13l4-4 3 3 5-7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10 5h4v4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Active Trades</span>
          <span className="tab-counter">{openPositions.length}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("archive")}
          className={`bot-nav-tab ${activeTab === "archive" ? "is-active" : ""}`}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <path d="M5 7h6M5 10h4" strokeLinecap="round" />
          </svg>
          <span>Closed Trades Archive</span>
          <span className="tab-counter">{closedTrades.length}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("decisions")}
          className={`bot-nav-tab ${activeTab === "decisions" ? "is-active" : ""}`}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 4h8M4 8h8M4 12h5" strokeLinecap="round" />
          </svg>
          <span>Decision Audit Log</span>
          <span className="tab-counter">{decisions.length}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("config")}
          className={`bot-nav-tab ${activeTab === "config" ? "is-active" : ""}`}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="8" cy="8" r="3" />
            <path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M3.8 12.2l1.4-1.4M10.8 5.2l1.4-1.4" strokeLinecap="round" />
          </svg>
          <span>Engine &amp; Risk Policy</span>
        </button>
      </nav>

      {/* Tab 1: Live AI Thoughts & Market Radar */}
      {activeTab === "radar" && (
        <div className="tab-panel-grid">
          {/* Current Brain / Thought Thesis */}
          <div className="terminal-panel">
            <div className="terminal-panel__header">
              <div className="terminal-panel__title">
                <span className="dot-cyan pulse-anim" />
                <h3>Active AI Reasoning &amp; Market Inspection</h3>
              </div>
              <span className="terminal-panel__timestamp mono" suppressHydrationWarning>
                Cycle: {latestDecision ? (isMounted ? new Date(latestDecision.created_at).toLocaleTimeString("en-GB", { hour12: false }) : "Live") : "Live"}
              </span>
            </div>

            <div className="ai-thesis-box">
              <div className="ai-thesis-headline">
                <span className={`decision-badge decision-badge--${latestDecision?.action || "wait"}`}>
                  {(latestDecision?.action || "WAIT").toUpperCase()}
                </span>
                <strong>{latestDecision?.symbol || "BYBIT UNIVERSE"}</strong>
                <span className="ai-thesis-tag">Market Regime Analysis</span>
              </div>
              <p className="ai-thesis-text">
                {latestDecision?.reasoning ||
                  "The autonomous bot runner is continuously evaluating Bybit Linear order books, liquidity spreads, and microstructure delta. When asymmetric risk/reward setups emerge, orders are placed automatically."}
              </p>

              {latestDecision?.evidence && Object.keys(latestDecision.evidence).length > 0 && (
                <div className="ai-evidence-pill-row">
                  {Object.entries(latestDecision.evidence).map(([key, val]) => (
                    <div key={key} className="ai-evidence-pill">
                      <span className="pill-key">{key}:</span>
                      <span className="pill-val mono">
                        {typeof val === "string" || typeof val === "number" || typeof val === "boolean"
                          ? `${val}`
                          : JSON.stringify(val)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Bybit Linear Live Radar Grid */}
          <div className="terminal-panel">
            <div className="terminal-panel__header">
              <div className="terminal-panel__title">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M2 11h12M4 7h8M6 3h4" strokeLinecap="round" />
                </svg>
                <h3>Primary Market Radar (Bybit Linear Feed)</h3>
              </div>
              <span className="terminal-panel__status mono">
                {isRadarLoading ? "Connecting..." : `${totalPairs > 0 ? `${totalPairs} Linear Pairs` : "Bybit Live Feed"} · 4s Poll`}
              </span>
            </div>

            {/* Dynamic Market Radar Controls (Zero Hardcode) */}
            <div className="radar-controls-bar">
              <div className="radar-filter-tabs">
                <button
                  type="button"
                  onClick={() => setRadarCategory("volume")}
                  className={`radar-tab-btn ${radarCategory === "volume" ? "is-active" : ""}`}
                >
                  🔥 Top Turnover
                </button>
                <button
                  type="button"
                  onClick={() => setRadarCategory("gainers")}
                  className={`radar-tab-btn ${radarCategory === "gainers" ? "is-active" : ""}`}
                >
                  🚀 Top Gainers
                </button>
                <button
                  type="button"
                  onClick={() => setRadarCategory("losers")}
                  className={`radar-tab-btn ${radarCategory === "losers" ? "is-active" : ""}`}
                >
                  🔻 Top Losers
                </button>
                <button
                  type="button"
                  onClick={() => setRadarCategory("volatility")}
                  className={`radar-tab-btn ${radarCategory === "volatility" ? "is-active" : ""}`}
                >
                  ⚡ High Volatility
                </button>
              </div>

              <div className="radar-search-wrap">
                <input
                  type="text"
                  value={radarSearch}
                  onChange={(e) => setRadarSearch(e.target.value)}
                  placeholder="Filter 900+ pairs (e.g. PEPE, HYPE, SOL)..."
                  className="radar-search-input"
                />
                {radarSearch && (
                  <button type="button" onClick={() => setRadarSearch("")} className="radar-search-clear">
                    ✕
                  </button>
                )}
              </div>
            </div>

            <div className="market-radar-list">
              {radarData.length === 0 ? (
                <div className="empty-panel-state">
                  <div className="dot-cyan pulse-anim" />
                  <p>Streaming Bybit Linear live order book telemetry...</p>
                </div>
              ) : (
                radarData.map((item) => {
                  const hasActivePosition = openPositions.some((p) => p.symbol === item.symbol);
                  return (
                    <div
                      key={item.symbol}
                      className={`radar-row ${hasActivePosition ? "radar-row--active" : ""}`}
                    >
                      <div className="radar-col-sym">
                        <div className="radar-sym-head" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          {hasActivePosition && <span className="dot-cyan pulse-anim" title="Active bot position" />}
                          <strong>{item.symbol}</strong>
                        </div>
                        <small>{item.name}</small>
                      </div>
                      <div className="radar-col-price mono">
                        <strong>{item.priceFormatted}</strong>
                        <span className={item.change24h >= 0 ? "text-green" : "text-red"}>
                          {item.changeFormatted}
                        </span>
                      </div>
                      <div className="radar-col-regime">
                        <span className="regime-tag">{item.regime}</span>
                        <small>Vol: {item.turnoverFormatted}</small>
                      </div>
                      <div className="radar-col-action">
                        {hasActivePosition ? (
                          <span className="status-indicator-tag" style={{ borderColor: "#00e5ff", color: "#00e5ff", background: "rgba(0,229,255,0.1)" }}>
                            ACTIVE TRADE
                          </span>
                        ) : (
                          <span className="status-indicator-tag">{item.status}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Active Trades */}
      {activeTab === "active" && (
        <div className="terminal-panel">
          <div className="terminal-panel__header">
            <h3>Active Open Positions ({openPositions.length})</h3>
            <span className="terminal-panel__status mono">Auto SL/TP Managed by Worker</span>
          </div>

          {openPositions.length === 0 ? (
            <div className="empty-panel-state">
              <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="6" y="8" width="28" height="24" rx="4" />
                <path d="M14 20h12M20 14v12" strokeLinecap="round" />
              </svg>
              <strong>No open positions currently</strong>
              <p>The bot is monitoring market conditions. When an entry setup is triggered, live trades will appear here.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="full-width-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Entry Price</th>
                    <th>Take Profit (TP)</th>
                    <th>Quantity</th>
                    <th>Stop Loss</th>
                    <th>Unrealized PnL</th>
                    <th>Status</th>
                    <th>Chart</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map((pos) => {
                    const isProfit = Number(pos.realized_pnl ?? 0) >= 0;
                    return (
                      <tr key={pos.id}>
                        <td>
                          <Link href={`/dashboard/signal/${pos.symbol}?trade=${pos.id}`} className="trade-chart-link" title="Open live chart & trade terminal">
                            <strong>{pos.symbol}</strong>
                            <span className="trade-chart-link__icon">↗</span>
                          </Link>
                        </td>
                        <td>
                          <span className={`side-badge side-badge--${pos.side}`}>
                            {pos.side.toUpperCase()}
                          </span>
                        </td>
                        <td className="mono">{pos.entry_avg ? `${formatCryptoPrice(pos.entry_avg)}` : "—"}</td>
                        <td className="mono">
                          {pos.targets && pos.targets.length > 0 ? (
                            <div className="tp-targets-inline">
                              {pos.targets.map((tgt) => (
                                <span key={tgt.idx} className={`tp-badge tp-badge--${tgt.status}`}>
                                  TP{tgt.idx}: ${formatCryptoPrice(tgt.price)} ({tgt.share_pct}%)
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted">Dynamic ATR</span>
                          )}
                        </td>
                        <td className="mono">{pos.qty ?? "—"}</td>
                        <td className="mono text-red">{pos.sl ? `${formatCryptoPrice(pos.sl)}` : "—"}</td>
                        <td className={`mono ${isProfit ? "text-green" : "text-red"}`}>
                          ${pos.realized_pnl ? Number(pos.realized_pnl).toFixed(2) : "$0.00"}
                        </td>
                        <td>
                          <span className="status-live-tag">{pos.status.toUpperCase()}</span>
                        </td>
                        <td>
                          <Link href={`/dashboard/signal/${pos.symbol}?trade=${pos.id}`} className="btn-view-chart">
                            📊 Графік
                          </Link>
                        </td>
                        <td>
                          <form action={closeTradeManually}>
                            <input type="hidden" name="trade_id" value={pos.id} />
                            <input type="hidden" name="bot_id" value={bot.id} />
                            <button type="submit" className="btn-close-position">
                              Exit Trade
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Closed Trades Archive */}
      {activeTab === "archive" && (
        <div className="terminal-panel">
          <div className="terminal-panel__header">
            <h3>Settled Trade Archive ({closedTrades.length})</h3>
            <span className="terminal-panel__status mono">Audited Paper Executions</span>
          </div>

          {closedTrades.length === 0 ? (
            <div className="empty-panel-state">
              <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="6" y="8" width="28" height="24" rx="3" />
                <path d="M12 16h16M12 22h10" strokeLinecap="round" />
              </svg>
              <strong>Archive is empty</strong>
              <p>Completed trades with exit prices and realized PnL will be recorded here.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="full-width-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Entry Price</th>
                    <th>Take Profit (TP)</th>
                    <th>Exit Price</th>
                    <th>Exit Reason</th>
                    <th>Realized PnL</th>
                    <th>Chart</th>
                    <th>Closed At</th>
                  </tr>
                </thead>
                <tbody>
                  {closedTrades.map((t) => {
                    const pnlVal = Number(t.realized_pnl ?? 0);
                    const isPositive = pnlVal > 0;
                    return (
                      <tr key={t.id}>
                        <td>
                          <Link href={`/dashboard/signal/${t.symbol}?trade=${t.id}`} className="trade-chart-link" title="Open chart & trade terminal">
                            <strong>{t.symbol}</strong>
                            <span className="trade-chart-link__icon">↗</span>
                          </Link>
                        </td>
                        <td>
                          <span className={`side-badge side-badge--${t.side}`}>
                            {t.side.toUpperCase()}
                          </span>
                        </td>
                        <td className="mono">{t.entry_avg ? `${formatCryptoPrice(t.entry_avg)}` : "—"}</td>
                        <td className="mono">
                          {t.targets && t.targets.length > 0 ? (
                            <div className="tp-targets-inline">
                              {t.targets.map((tgt) => (
                                <span key={tgt.idx} className={`tp-badge tp-badge--${tgt.status}`}>
                                  TP{tgt.idx}: ${formatCryptoPrice(tgt.price)}
                                  {tgt.status === "filled" && " ✓"}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted">Dynamic ATR</span>
                          )}
                        </td>
                        <td className="mono">{t.exit_price ? `${formatCryptoPrice(t.exit_price)}` : "—"}</td>
                        <td>
                          <span className="exit-reason-tag">
                            {t.exit_reason ? t.exit_reason.replaceAll("_", " ").toUpperCase() : "RESOLVED"}
                          </span>
                        </td>
                        <td className={`mono ${isPositive ? "text-green" : pnlVal < 0 ? "text-red" : ""}`}>
                          {isPositive ? "+" : ""}${pnlVal.toFixed(2)}
                        </td>
                        <td>
                          <Link href={`/dashboard/signal/${t.symbol}?trade=${t.id}`} className="btn-view-chart">
                            📊 Графік
                          </Link>
                        </td>
                        <td className="mono text-muted" suppressHydrationWarning>
                          {t.closed_at ? (isMounted ? new Date(t.closed_at).toLocaleString("en-GB", { hour12: false }) : "—") : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Decision Audit Log */}
      {activeTab === "decisions" && (
        <div className="terminal-panel">
          <div className="terminal-panel__header">
            <h3>Autonomous 30-Second Cycle Log ({decisions.length})</h3>
            <span className="terminal-panel__status mono">Immutable DB Records</span>
          </div>

          {decisions.length === 0 ? (
            <div className="empty-panel-state">
              <strong>No decisions logged yet</strong>
              <p>Start the bot to initiate the 30-second automated market cycle.</p>
            </div>
          ) : (
            <div className="decisions-stream">
              {decisions.map((dec) => (
                <div key={dec.id} className="decision-item">
                  <div className="decision-item__head">
                    <span className={`decision-badge decision-badge--${dec.action}`}>
                      {dec.action.toUpperCase()}
                    </span>
                    {dec.symbol && <strong className="decision-sym mono">{dec.symbol}</strong>}
                    <time className="decision-time mono" suppressHydrationWarning>
                      {isMounted
                        ? `${new Date(dec.created_at).toLocaleTimeString("en-GB", { hour12: false })} · ${new Date(dec.created_at).toLocaleDateString("en-GB")}`
                        : "—"}
                    </time>
                  </div>
                  <p className="decision-reason">{dec.reasoning}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Engine & Risk Policy Configuration */}
      {activeTab === "config" && (
        <div className="terminal-panel">
          <div className="terminal-panel__header">
            <h3>Engine &amp; Risk Parameters</h3>
            <span className="terminal-panel__status mono">Immutable Guardrails</span>
          </div>

          <div className="config-grid">
            <div className="config-box">
              <h4>Strategy Policy</h4>
              <dl className="config-dl">
                <div><dt>Strategy Mode</dt><dd className="mono text-cyan">{bot.strategy.toUpperCase()}</dd></div>
                <div><dt>Regime Handling</dt><dd>Autonomous Regime Detection</dd></div>
                <div><dt>Direction</dt><dd>Dynamic Long &amp; Short</dd></div>
                <div><dt>Execution Adapter</dt><dd className="mono">Vexqora Paper Engine</dd></div>
              </dl>
            </div>

            <div className="config-box">
              <h4>Risk &amp; Safety Guardrails</h4>
              <form action={updateBotSettings} className="bot-settings-form">
                <input type="hidden" name="id" value={bot.id} />
                <label>Risk per trade (%)<input name="risk_per_trade_pct" type="number" min="0.1" max="100" step="0.1" defaultValue={bot.risk_per_trade_pct} placeholder="0.1% – 100%" /></label>
                <label>
                  Trading Direction
                  <select name="direction" defaultValue={bot.direction || "both"}>
                    <option value="both">🤖 Dynamic (Autonomous AI Market Choice)</option>
                    <option value="long">📈 Long Only</option>
                    <option value="short">📉 Short Only</option>
                  </select>
                </label>
                <label>Target balance (USDT)<input name="target_balance" type="number" min="0" step="0.01" defaultValue={bot.target_balance ?? ""} placeholder="No target (continuous)" /></label>
                <label>When target reached<select name="goal_action" defaultValue={bot.goal_action}><option value="pause">Pause</option><option value="stop">Stop</option><option value="continue">Continue</option></select></label>
                <label>Max daily loss limit (%)<input name="max_daily_loss_pct" type="number" min="0.1" max="100" step="0.5" defaultValue={bot.max_daily_loss_pct} placeholder="0.1% – 100%" /></label>
                <button type="submit" className="btn-terminal btn-terminal--scan">Save Settings</button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
