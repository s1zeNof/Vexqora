"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { LiveBotSummaryItem } from "../../api/bots/live/route";
import { setBotStatus } from "./actions";

interface BotListViewProps {
  initialBots: LiveBotSummaryItem[];
  initialPaperBalance: number;
}

function StatusDot({ status }: { status: LiveBotSummaryItem["status"] }) {
  const colors: Record<LiveBotSummaryItem["status"], string> = {
    running: "#00E676",
    stopped: "#64748B",
    paused: "#F59E0B",
    error: "#EF4444",
  };
  return (
    <span
      aria-label={status}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: colors[status],
        flexShrink: 0,
        boxShadow: status === "running" ? "0 0 8px rgba(0, 230, 118, 0.45)" : undefined,
      }}
    />
  );
}

function PnlValue({ allocated, current }: { allocated: number; current: number }) {
  const pnl = current - allocated;
  const pct = allocated > 0 ? (pnl / allocated) * 100 : 0;
  const color = pnl > 0 ? "#00E676" : pnl < 0 ? "#EF4444" : "#94A3B8";
  return (
    <span className="mono" style={{ color, fontSize: 13, fontWeight: 600 }}>
      {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}{" "}
      <span style={{ fontSize: 11, opacity: 0.85 }}>({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%)</span>
    </span>
  );
}

function ProgressBar({ current, target, allocated }: { current: number; target: number; allocated: number }) {
  const pct = Math.min(100, Math.max(0, ((current - allocated) / (target - allocated)) * 100));
  return (
    <div className="target-progress-bar">
      <div className="target-progress-bar__labels">
        <span>Target progress</span>
        <span className="mono">{pct.toFixed(0)}%</span>
      </div>
      <div className="target-progress-bar__track">
        <div style={{ width: `${pct}%` }} className="target-progress-bar__fill" />
      </div>
    </div>
  );
}

export function BotListView({ initialBots, initialPaperBalance }: BotListViewProps) {
  const [bots, setBots] = useState<LiveBotSummaryItem[]>(initialBots);
  const [, setPaperBalance] = useState<number>(initialPaperBalance);
  const [isLiveSyncing, setIsLiveSyncing] = useState<boolean>(false);
  const [now, setNow] = useState<number>(Date.now());
  const [isMounted, setIsMounted] = useState<boolean>(false);
  const [pendingBotId, setPendingBotId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Initial client mount and 1s ticker for second-based counters
  useEffect(() => {
    setIsMounted(true);
    setNow(Date.now());
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, []);

  // 3-second live AJAX polling across all bots
  useEffect(() => {
    let active = true;

    async function pollLiveBots() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        setIsLiveSyncing(true);
        const res = await fetch("/api/bots/live", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as {
            success?: boolean;
            bots?: LiveBotSummaryItem[];
            paperBalance?: number;
          };
          if (active && data.success && Array.isArray(data.bots)) {
            setBots(data.bots);
            if (typeof data.paperBalance === "number") {
              setPaperBalance(data.paperBalance);
            }
          }
        }
      } catch {
        // preserve current list on network flicker
      } finally {
        if (active) setIsLiveSyncing(false);
      }
    }

    const interval = setInterval(() => {
      void pollLiveBots();
    }, 3000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const handleStatusChange = (botId: string, intent: "start" | "pause" | "stop") => {
    setPendingBotId(botId);
    const newStatus = intent === "start" ? "running" : intent === "pause" ? "paused" : "stopped";

    // Optimistic UI update
    setBots((prev) =>
      prev.map((b) => (b.id === botId ? { ...b, status: newStatus } : b))
    );

    const formData = new FormData();
    formData.append("id", botId);
    formData.append("intent", intent);

    startTransition(async () => {
      try {
        await setBotStatus(formData);
        // Force refresh immediately after action
        const res = await fetch("/api/bots/live", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { success?: boolean; bots?: LiveBotSummaryItem[] };
          if (data.success && Array.isArray(data.bots)) {
            setBots(data.bots);
          }
        }
      } catch {
        // revert on error
      } finally {
        setPendingBotId(null);
      }
    });
  };

  return (
    <section className="bots-list-section">
      <div className="bots-list-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2 className="bots-section-title">Active Bots ({bots.length})</h2>
          <div className="bot-live-sync-badge" title="Real-time AJAX synchronization active every 3 seconds">
            <span className={`sync-indicator-dot ${isLiveSyncing ? "sync-indicator-dot--syncing" : ""}`} />
            <span>AJAX Live Feed (3s)</span>
          </div>
        </div>
        <span className="bots-list-hint">Background runner executes 24/7 independently of open browser tabs</span>
      </div>

      {bots.length === 0 ? (
        <div className="bots-empty">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="8" y="14" width="32" height="24" rx="4" />
            <path d="M24 6v8M16 24h.01M32 24h.01M18 32h12" />
          </svg>
          <strong>No active bots</strong>
          <span>Create your first Paper Bot above to begin autonomous algorithmic trading.</span>
        </div>
      ) : (
        <div className="bots-grid">
          {bots.map((bot) => {
            const displayedBalance = bot.audited_balance;
            const hasTarget = bot.target_balance !== null && bot.target_balance > bot.allocated_capital;
            const hbTime = bot.last_heartbeat_at ? new Date(bot.last_heartbeat_at).getTime() : 0;
            const secSinceHb = isMounted && hbTime > 0 && now > 0 ? Math.max(0, Math.floor((now - hbTime) / 1000)) : null;
            const isRunnerHealthy = secSinceHb !== null && secSinceHb < 60 && bot.status === "running";
            const isPendingThisBot = pendingBotId === bot.id;

            return (
              <article key={bot.id} className={`bot-card bot-card--${bot.status}`}>
                {/* Header */}
                <div className="bot-card__header">
                  <div className="bot-card__identity">
                    <StatusDot status={bot.status} />
                    <div>
                      <h3 className="bot-card__name">
                        <Link href={`/dashboard/bots/${bot.id}`} className="bot-card__title-link">
                          {bot.name}
                        </Link>
                      </h3>
                      {bot.description && <p className="bot-card__desc">{bot.description}</p>}
                    </div>
                  </div>
                  <div className="bot-card__badges">
                    <span className="badge badge--paper">{bot.mode.toUpperCase()}</span>
                    <span className="badge badge--strategy">{bot.strategy}</span>
                    <span className={`badge badge--status badge--status-${bot.status}`}>
                      {bot.status.toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Live Position & Activity Banner */}
                <div className="bot-card__live-banner">
                  {bot.active_positions_count > 0 ? (
                    <div className="bot-pos-indicator bot-pos-indicator--active">
                      <span className="bot-pos-indicator__dot" />
                      <span>
                        🔥 В ринку: <strong>{bot.active_symbols.join(", ")}</strong> ({bot.active_positions_count} {bot.active_positions_count === 1 ? "угода" : "угоди"})
                      </span>
                    </div>
                  ) : (
                    <div className="bot-pos-indicator bot-pos-indicator--idle">
                      <span className="bot-pos-indicator__dot-idle" />
                      <span>💤 У кеші · Автономний моніторинг Bybit Linear</span>
                    </div>
                  )}

                  {/* Runner Pulse & Status */}
                  <div className="bot-card__runner-pulse">
                    {bot.status === "running" ? (
                      isRunnerHealthy ? (
                        <span className="runner-pulse-tag runner-pulse-tag--active">
                          <span className="beacon-active" /> Раннер активний (пульс: {secSinceHb}с тому)
                        </span>
                      ) : (
                        <span className="runner-pulse-tag runner-pulse-tag--waiting">
                          <span className="beacon-stalled" /> Раннер очікує циклу ({secSinceHb !== null ? `${secSinceHb}с` : "старт..."})
                        </span>
                      )
                    ) : (
                      <span className="runner-pulse-tag runner-pulse-tag--paused">
                        ⏸️ Раннер зупинено користувачем
                      </span>
                    )}
                  </div>
                </div>

                {/* Latest Decision Preview */}
                {bot.latest_decision && (
                  <div className="bot-card__latest-decision">
                    <div className="bot-card__decision-meta">
                      <span className={`bot-decision-pill bot-decision-pill--${bot.latest_decision.action}`}>
                        {bot.latest_decision.action === "enter" && "⚡ ВХІД"}
                        {bot.latest_decision.action === "wait" && "⏸️ ОЧІКУВАННЯ"}
                        {bot.latest_decision.action === "blocked" && "🛡️ БЛОКУВАННЯ"}
                        {bot.latest_decision.action === "manage" && "📊 СУПРОВІД"}
                        {bot.latest_decision.action === "exit" && "🛑 ВИХІД"}
                        {!["enter", "wait", "blocked", "manage", "exit"].includes(bot.latest_decision.action) &&
                          bot.latest_decision.action.toUpperCase()}
                      </span>
                      {bot.latest_decision.symbol && (
                        <span className="mono bot-decision-symbol">{bot.latest_decision.symbol}</span>
                      )}
                      <span className="bot-decision-time mono">
                        {isMounted
                          ? `${Math.max(0, Math.floor((now - new Date(bot.latest_decision.created_at).getTime()) / 1000))}с тому`
                          : "щойно"}
                      </span>
                    </div>
                    <p className="bot-decision-text" title={bot.latest_decision.reasoning}>
                      {bot.latest_decision.reasoning.length > 120
                        ? `${bot.latest_decision.reasoning.slice(0, 120)}...`
                        : bot.latest_decision.reasoning}
                    </p>
                  </div>
                )}

                {/* Metrics */}
                <div className="bot-card__metrics">
                  <div className="bot-card__metric">
                    <span>Allocated</span>
                    <strong className="mono">${bot.allocated_capital.toFixed(2)}</strong>
                  </div>
                  <div className="bot-card__metric">
                    <span>Current Balance</span>
                    <strong className="mono">${displayedBalance.toFixed(2)}</strong>
                  </div>
                  <div className="bot-card__metric">
                    <span>PnL</span>
                    <PnlValue allocated={bot.allocated_capital} current={displayedBalance} />
                  </div>
                  {bot.target_balance && (
                    <div className="bot-card__metric">
                      <span>Target Goal</span>
                      <strong className="mono">${bot.target_balance.toFixed(2)}</strong>
                    </div>
                  )}
                </div>

                {hasTarget && (
                  <ProgressBar
                    current={displayedBalance}
                    target={Number(bot.target_balance)}
                    allocated={bot.allocated_capital}
                  />
                )}

                <div className="bot-card__params">
                  <span>Risk policy: {bot.risk_per_trade_pct}%/trade · Max daily loss: {bot.max_daily_loss_pct}%</span>
                  <span>When target reached: {bot.goal_action}</span>
                </div>

                {/* Actions */}
                <div className="bot-card__actions">
                  {bot.status !== "running" && (
                    <button
                      className="btn btn--start"
                      disabled={isPendingThisBot}
                      onClick={() => handleStatusChange(bot.id, "start")}
                      type="button"
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4 3l9 5-9 5V3z" />
                      </svg>
                      <span>Start</span>
                    </button>
                  )}
                  {bot.status === "running" && (
                    <button
                      className="btn btn--pause"
                      disabled={isPendingThisBot}
                      onClick={() => handleStatusChange(bot.id, "pause")}
                      type="button"
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4.5 3h2v10h-2V3zm5 0h2v10h-2V3z" />
                      </svg>
                      <span>Pause</span>
                    </button>
                  )}
                  <button
                    className="btn btn--stop"
                    disabled={isPendingThisBot}
                    onClick={() => handleStatusChange(bot.id, "stop")}
                    type="button"
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor">
                      <rect x="3" y="3" width="10" height="10" rx="1.5" />
                    </svg>
                    <span>Stop</span>
                  </button>

                  <Link href={`/dashboard/bots/${bot.id}`} className="btn btn--ghost" style={{ marginLeft: "auto" }}>
                    <span>Термінал бота ↗</span>
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
