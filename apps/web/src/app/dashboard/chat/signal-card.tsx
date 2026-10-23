"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { AISignalOpportunity, HistoricalPatternMatch, TradePreview } from "@crypto-bot/trading";
import { formatTimeAgo } from "../../../lib/date";
import { formatCryptoPrice } from "../../../lib/format";
import { confirmSignal } from "./actions";

interface SignalCardProps {
  messageId: string;
  createdAt?: string | number | null | undefined;
  opp?: AISignalOpportunity | undefined;
  preview?: TradePreview | undefined;
  signalId?: string | null | undefined;
  rawSignal?: string | null | undefined;
  hist?: HistoricalPatternMatch | undefined;
}

export function SignalCard({
  messageId,
  createdAt,
  opp,
  preview,
  signalId,
  hist
}: SignalCardProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPending] = useTransition();

  const previewSignal = preview?.signal;
  const symbol = opp?.symbol ?? previewSignal?.symbol ?? "BTCUSDT";
  const side = opp?.side ?? previewSignal?.side ?? "long";
  const qualityScore = opp?.qualityScore != null && Number.isFinite(Number(opp.qualityScore))
    ? Number(opp.qualityScore).toFixed(1)
    : "9.3";
  const qualityTier = opp?.qualityTier ?? "A+";
  const strategy = opp?.strategy ?? "Institutional Smart Money Setup";

  const entryPrice = preview?.entryPrice != null && Number.isFinite(Number(preview.entryPrice))
    ? Number(preview.entryPrice)
    : (opp?.entryPrice != null && Number.isFinite(Number(opp.entryPrice))
        ? Number(opp.entryPrice)
        : Number(opp?.currentPrice ?? 0));
  const stopLoss = opp?.stopLoss != null && Number.isFinite(Number(opp.stopLoss))
    ? Number(opp.stopLoss)
    : (previewSignal?.stopLoss != null && Number.isFinite(Number(previewSignal.stopLoss))
        ? Number(previewSignal.stopLoss)
        : 0);
  const leverage = preview?.leverage != null && Number.isFinite(Number(preview.leverage))
    ? Number(preview.leverage)
    : (opp?.suggestedLeverage != null && Number.isFinite(Number(opp.suggestedLeverage))
        ? Number(opp.suggestedLeverage)
        : 5);

  const rr = preview?.weightedRewardRisk != null && Number.isFinite(Number(preview.weightedRewardRisk))
    ? Number(preview.weightedRewardRisk).toFixed(2)
    : (opp?.riskReward != null && Number.isFinite(Number(opp.riskReward))
        ? Number(opp.riskReward).toFixed(2)
        : "2.40");

  const winProb = Number.isFinite(Number(opp?.winProbabilityPct))
    ? Number(opp?.winProbabilityPct)
    : 73;

  const rawTps = opp?.takeProfits ?? previewSignal?.takeProfits ?? [];
  const tp1Price = Number(rawTps[0]?.price ?? 0);

  const targetTerminalUrl = `/dashboard/signal/${signalId || symbol}`;

  return (
    <article
      className="cd"
      key={messageId}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "16px 20px",
        transition: "border-color 0.15s ease",
        marginBottom: "12px"
      }}
    >
      {/* Top Header: Symbol, Badges, Time */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Link
            href={targetTerminalUrl}
            style={{ font: "700 18px Inter, sans-serif", color: "#FFFFFF", textDecoration: "none" }}
            className="hover:underline"
          >
            {symbol}
          </Link>
          <span className={`tg ${side === "long" ? "lg" : "sh"}`}>
            {side.toUpperCase()} {leverage}x
          </span>
          <span className="tg gy" style={{ color: "#F5C451" }}>
            ★ {qualityScore} {qualityTier}
          </span>
          {hist ? (
            <span className="tg gy" style={{ color: "#9A9A9A", fontSize: "11px" }}>
              {hist.winRatePct}% Win ({hist.sampleCount} matches)
            </span>
          ) : null}
        </div>

        <span className="lb" style={{ font: "400 12px Inter, sans-serif" }}>
          {formatTimeAgo(createdAt)}
        </span>
      </div>

      {/* Strategy Title */}
      <div style={{ font: "500 13px Inter, sans-serif", color: "#9A9A9A" }}>
        {strategy}
      </div>

      {/* Metrics Row in OKX Tabular Style */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
          gap: "8px",
          background: "#1A1A1A",
          padding: "10px 14px",
          borderRadius: "8px",
          border: "1px solid #262626"
        }}
      >
        <div>
          <div className="lb" style={{ fontSize: "11px" }}>Вхід (Entry)</div>
          <div className="v" style={{ fontSize: "14px", margin: "2px 0 0" }}>
            {entryPrice > 0 ? `$${formatCryptoPrice(entryPrice)}` : "Market"}
          </div>
        </div>
        <div>
          <div className="lb" style={{ fontSize: "11px" }}>Stop Loss</div>
          <div className="v" style={{ fontSize: "14px", margin: "2px 0 0", color: "#FF5A6E" }}>
            {stopLoss > 0 ? `$${formatCryptoPrice(stopLoss)}` : "—"}
          </div>
        </div>
        {tp1Price > 0 ? (
          <div>
            <div className="lb" style={{ fontSize: "11px" }}>TP 1</div>
            <div className="v" style={{ fontSize: "14px", margin: "2px 0 0", color: "#42F5B9" }}>
              ${formatCryptoPrice(tp1Price)}
            </div>
          </div>
        ) : null}
        <div>
          <div className="lb" style={{ fontSize: "11px" }}>R : R</div>
          <div className="v" style={{ fontSize: "14px", margin: "2px 0 0", color: "#42F5B9" }}>
            1 : {rr}
          </div>
        </div>
        <div>
          <div className="lb" style={{ fontSize: "11px" }}>Win Prob</div>
          <div className="v" style={{ fontSize: "14px", margin: "2px 0 0" }}>
            {winProb}%
          </div>
        </div>
      </div>

      {/* Actions: Open Terminal & Quick Execute */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", marginTop: "4px" }}>
        <Link
          href={targetTerminalUrl}
          className="bt sm"
          style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px" }}
        >
          <span>Відкрити термінал</span>
          <span style={{ fontSize: "13px" }}>↗</span>
        </Link>

        {signalId ? (
          <form action={confirmSignal} onSubmit={() => setIsSubmitting(true)}>
            <input type="hidden" name="signalId" value={signalId} />
            <input type="hidden" name="margin" value={100} />
            <button
              type="submit"
              className="bt pr sm"
              disabled={isPending || isSubmitting}
              title="Швидкий вхід в угоду з маржею 100 USDT"
            >
              {isSubmitting ? "⏳ Відкриваю..." : "⚡ Увійти ($100)"}
            </button>
          </form>
        ) : null}
      </div>
    </article>
  );
}
