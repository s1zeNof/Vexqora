"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { calculateScalpingEconomics } from "@crypto-bot/trading/scalping-economics";
import { formatCryptoPrice } from "@crypto-bot/shared";

export interface ScalpingSetup {
  id: string; symbol: string; side: "long" | "short"; entry: number; stopLoss: number; tp1: number;
  strategy: string | null; rationale: string | null; decision: "TRADE" | "WAIT_FOR_CONFIRMATION" | "REVIEW";
  regime: string | null; expiresAtMs: number | null; generatedAt: string; source: string;
  probability: number | null; probabilityCalibrated: boolean;
}

export function ScalpingWorkbench({ initialSetups, accountLabel, initialDeposit }: { initialSetups: ScalpingSetup[]; accountLabel: string; initialDeposit: number }) {
  const router = useRouter();
  const [deposit, setDeposit] = useState(Math.max(1, Math.min(initialDeposit, 10_000)));
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    const refresh = window.setInterval(() => router.refresh(), 20_000);
    return () => { window.clearInterval(clock); window.clearInterval(refresh); };
  }, [router]);

  const rows = useMemo(() => initialSetups.map((setup) => ({
    setup,
    economics: calculateScalpingEconomics({
      depositUsdt: deposit, entryPrice: setup.entry, stopLossPrice: setup.stopLoss, takeProfitPrice: setup.tp1,
      leverage: 3, riskPerTradePct: 1, minimumNotionalUsdt: 5, takerFeeBps: 5.5, spreadBps: 2, slippageBps: 3
    })
  })), [deposit, initialSetups]);

  async function scan() {
    setScanning(true); setError(null);
    try {
      const response = await fetch("/api/market/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: "UNIVERSE", filter: "moderate" }) });
      const result = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !result.success) throw new Error(result.error || "Market scan failed");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Market scan failed"); }
    finally { setScanning(false); }
  }

  return <div className="scalping-desk">
    <header className="scalping-desk__header"><div><span className="eyebrow">Live Trading Intelligence</span><h1>Scalping Desk</h1><p>Server scanner monitors Bybit independently of this tab. Only grounded, persisted setups appear here.</p></div><div className="scalping-desk__status"><i />Worker feed · {accountLabel}</div></header>
    <section className="scalping-controls" aria-label="Scalping parameters"><label>Available capital <span><input type="number" min="1" step="1" value={deposit} onChange={(event) => setDeposit(Number(event.target.value) || 1)} inputMode="decimal" /> USDT</span></label><div><span>Risk</span><strong>1.0%</strong></div><div><span>Sizing leverage</span><strong>3×</strong></div><div><span>Cost model</span><strong>Fees + spread + slippage</strong></div><button type="button" onClick={() => void scan()} disabled={scanning}>{scanning ? "Analyzing…" : "Analyze market now"}</button></section>
    {error && <p className="scalping-error" role="alert">{error}</p>}
    <div className="scalping-table" role="region" aria-label="Current scalping setups" tabIndex={0}><table><thead><tr><th>Market</th><th>Decision</th><th>Regime</th><th>Entry / SL / TP1</th><th>Costs</th><th>Projected net</th><th>After-cost R:R</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{rows.map(({ setup, economics }) => {
      const stale = setup.expiresAtMs === null || (now > 0 && setup.expiresAtMs <= now);
      return <tr key={setup.id}><td><strong>{setup.symbol}</strong><small>Bybit perpetual · {setup.side.toUpperCase()}</small></td><td>{setup.decision.replaceAll("_", " ")}<small>{setup.strategy || "Strategy not reported"}</small></td><td>{setup.regime || "Unavailable"}<small>{setup.probabilityCalibrated && setup.probability !== null ? `${setup.probability.toFixed(1)}% calibrated` : "No calibrated probability"}</small></td><td className="mono">{formatCryptoPrice(setup.entry)}<small>SL {formatCryptoPrice(setup.stopLoss)} · TP {formatCryptoPrice(setup.tp1)}</small></td><td className="mono">${(economics.estimatedFeesUsdt + economics.estimatedSpreadUsdt + economics.estimatedSlippageUsdt).toFixed(3)}<small>Notional ${economics.positionNotionalUsdt.toFixed(2)}</small></td><td className={economics.feasible ? "is-profit" : "is-loss"}>{economics.feasible ? `+$${economics.estimatedNetProfitUsdt.toFixed(3)}` : "No trade"}<small>{economics.reason || `Risk −$${economics.estimatedNetLossUsdt.toFixed(3)}`}</small></td><td className="mono">{economics.rewardRiskAfterCosts?.toFixed(2) ?? "—"}</td><td><span className={stale ? "status-stale" : "status-live"}>{stale ? "Stale" : "Current"}</span><small>{new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(setup.generatedAt))}</small></td><td><Link href={`/dashboard/signal/${setup.id}`}>Inspect</Link></td></tr>;
    })}</tbody></table>{rows.length === 0 && <div className="scalping-empty"><strong>No qualified setup is active</strong><span>The scanner has not persisted a cost-valid opportunity in the last 48 hours. This is a valid No Trade state.</span></div>}</div>
    <footer className="scalping-desk__notice">Estimates use a conservative configurable cost model. Exchange instrument limits are validated again by the execution engine before any order.</footer>
  </div>;
}
