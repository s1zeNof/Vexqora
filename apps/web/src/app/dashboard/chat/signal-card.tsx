"use client";

import { useEffect, useState, useTransition } from "react";
import type { AISignalOpportunity, HistoricalPatternMatch, NemotronVisionAnalysis, TradePreview } from "@crypto-bot/trading";
import { TradingViewChart } from "../../../components/trading-view-chart";
import { formatTimeAgo } from "../../../lib/date";
import { formatCryptoPrice } from "../../../lib/format";
import { confirmSignal, enhanceSignalAction } from "./actions";

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
  rawSignal,
  hist
}: SignalCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"chart" | "smc" | "targets" | "mobile" | "vision">("chart");
  const [customMargin, setCustomMargin] = useState<number>(100);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [visionImage, setVisionImage] = useState<string | null>(null);
  const [visionAnalyzing, setVisionAnalyzing] = useState(false);
  const [visionResult, setVisionResult] = useState<NemotronVisionAnalysis | null>(null);
  const [isPending] = useTransition();

  // Close modal on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsModalOpen(false);
    }
    if (isModalOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isModalOpen]);

  const previewSignal = preview?.signal;
  const symbol = opp?.symbol ?? previewSignal?.symbol ?? "BTCUSDT";
  const side = opp?.side ?? previewSignal?.side ?? "long";
  const qualityScore = opp?.qualityScore != null && Number.isFinite(Number(opp.qualityScore))
    ? Number(opp.qualityScore).toFixed(1)
    : "9.3";
  const qualityTier = opp?.qualityTier ?? "A+";
  const strategy = opp?.strategy ?? "Institutional Smart Money Setup";
  const rationale = opp?.rationale ?? "Structural liquidity sweep and volume confirmation.";

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
  const riskPct = preview?.riskPct != null && Number.isFinite(Number(preview.riskPct))
    ? Number(preview.riskPct).toFixed(1)
    : "1.0";
  const riskAmount = preview?.riskAmount != null && Number.isFinite(Number(preview.riskAmount))
    ? Number(preview.riskAmount).toFixed(2)
    : null;
  const qty = preview?.qty != null && Number.isFinite(Number(preview.qty))
    ? Number(preview.qty)
    : 0;
  const winProb = Number.isFinite(Number(opp?.winProbabilityPct))
    ? Number(opp?.winProbabilityPct)
    : 73;
  const rr = preview?.weightedRewardRisk != null && Number.isFinite(Number(preview.weightedRewardRisk))
    ? Number(preview.weightedRewardRisk).toFixed(2)
    : (opp?.riskReward != null && Number.isFinite(Number(opp.riskReward))
        ? Number(opp.riskReward).toFixed(2)
        : "2.40");

  const effectiveMargin = customMargin > 0 ? customMargin : 100;
  const notionalPosition = effectiveMargin * leverage;
  const effectiveQty = entryPrice > 0 ? notionalPosition / entryPrice : (qty > 0 ? qty : 0);

  const rawTps = opp?.takeProfits ?? previewSignal?.takeProfits ?? [];
  const takeProfits = rawTps.map((t, idx) => {
    const price = Number(t?.price ?? 0);
    const sharePct = Number(t?.sharePct ?? 0);
    const pctGain = entryPrice > 0
      ? (side === "long" ? ((price - entryPrice) / entryPrice) * 100 : ((entryPrice - price) / entryPrice) * 100)
      : 0;
    const estProfit = effectiveQty > 0
      ? (side === "long" ? (price - entryPrice) * effectiveQty * (sharePct / 100) : (entryPrice - price) * effectiveQty * (sharePct / 100))
      : 0;
    return {
      idx: idx + 1,
      price,
      sharePct,
      pctGain: Number.isFinite(pctGain) ? Number(pctGain.toFixed(2)) : 0,
      estProfit: Number.isFinite(estProfit) ? Number(estProfit.toFixed(2)) : 0
    };
  });

  const maxTotalProfit = takeProfits.reduce((acc, curr) => acc + (Number.isFinite(curr.estProfit) ? curr.estProfit : 0), 0);
  const estSlLoss = effectiveQty > 0 && entryPrice > 0 && stopLoss > 0
    ? Math.abs(entryPrice - stopLoss) * effectiveQty
    : (riskAmount ? Number(riskAmount) : 0);
  const rawSlPct = entryPrice > 0
    ? (side === "long" ? ((entryPrice - stopLoss) / entryPrice) * 100 : ((stopLoss - entryPrice) / entryPrice) * 100)
    : 0;
  const slPct = Number.isFinite(rawSlPct) ? rawSlPct : 0;

  const tp1 = takeProfits[0];

  const mobileText = `#${symbol} ${side.toUpperCase()} ${leverage}x
📍 Вхід: ${entryPrice > 0 ? `$${formatCryptoPrice(entryPrice)}` : "Market"}
🛑 Стоп-лосс: $${formatCryptoPrice(stopLoss)} (-${slPct.toFixed(2)}%)
${takeProfits.map(t => `🎯 TP${t.idx}: $${formatCryptoPrice(t.price)} (+${t.pctGain}%) [${t.sharePct}%]`).join("\n")}
⚡ Плече: ${leverage}x · Ризик: ${riskPct}%`;

  const copyMobileText = async () => {
    try {
      await navigator.clipboard.writeText(mobileText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setVisionImage(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const runVisionAnalysis = async () => {
    if (!visionImage) return;
    setVisionAnalyzing(true);
    try {
      const res = await fetch("/api/ai/vision-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: visionImage, symbol })
      });
      if (res.ok) {
        const data = await res.json() as { analysis: NemotronVisionAnalysis };
        setVisionResult(data.analysis);
      }
    } catch (err) {
      console.error("Vision analyze failed:", err);
    } finally {
      setVisionAnalyzing(false);
    }
  };

  return (
    <>
      {/* Sleek, Minimalist Feed Card Row */}
      <article
        className="compact-signal-row"
        key={messageId}
        onClick={() => setIsModalOpen(true)}
      >
        <div className="compact-signal-left">
          <div className="compact-title-wrap">
            <strong className="compact-symbol">{symbol}</strong>
            <span className={`badge ${side === "long" ? "long" : "short"}`}>
              {side.toUpperCase()} {leverage}x
            </span>
            <span className="compact-score">★ {qualityScore} {qualityTier}</span>
          </div>
          <span className="compact-strategy">{strategy}</span>
        </div>

        {/* Clean Key Metrics */}
        <div className="compact-signal-metrics">
          <div className="metric-pill">
            <span className="pill-label">Вхід</span>
            <strong className="mono">{entryPrice > 0 ? `$${formatCryptoPrice(entryPrice)}` : "Market"}</strong>
          </div>
          <div className="metric-pill">
            <span className="pill-label">SL</span>
            <strong className="mono negative">${stopLoss > 0 ? formatCryptoPrice(stopLoss) : "—"}</strong>
          </div>
          {tp1 ? (
            <div className="metric-pill">
              <span className="pill-label">TP 1</span>
              <strong className="mono positive">${formatCryptoPrice(tp1.price)}</strong>
            </div>
          ) : null}
          <div className="metric-pill">
            <span className="pill-label">R:R</span>
            <strong className="mono positive">1:{rr}</strong>
          </div>
          <div className="metric-pill">
            <span className="pill-label">Win</span>
            <strong className="mono" style={{ color: "var(--soft-violet)" }}>{winProb}%</strong>
          </div>
        </div>

        {/* Actions & Time */}
        <div className="compact-signal-actions" onClick={(e) => e.stopPropagation()}>
          <span className="pulse-tag mono compact-time">
            ⏱ {formatTimeAgo(createdAt)}
          </span>
          <button
            type="button"
            className="button secondary compact-btn"
            onClick={() => setIsModalOpen(true)}
          >
            📈 Графік / $
          </button>
          {signalId ? (
            <form action={confirmSignal} onSubmit={() => setIsSubmitting(true)}>
              <input type="hidden" name="signalId" value={signalId} />
              <input type="hidden" name="margin" value={effectiveMargin} />
              <button
                type="submit"
                className="button primary compact-btn-primary"
                disabled={isPending || isSubmitting}
                title={`Увійти в угоду з маржею ${effectiveMargin} USDT (${leverage}x)`}
              >
                {isSubmitting ? "⏳ Відкриваю..." : `⚡ Увійти ($${effectiveMargin})`}
              </button>
            </form>
          ) : null}
        </div>
      </article>

      {/* Institutional Pop-up Modal with Tabs */}
      {isModalOpen ? (
        <div className="signal-modal-backdrop" onClick={() => setIsModalOpen(false)}>
          <div className="signal-modal-content" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="modal-header">
              <div className="modal-title-box">
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <strong style={{ fontSize: "20px", color: "var(--text-main)" }}>{symbol}</strong>
                  <span className={`badge ${side === "long" ? "long" : "short"}`} style={{ fontSize: "12px" }}>
                    {side.toUpperCase()} {leverage}x
                  </span>
                  <span className="ai-score-badge">★ {qualityScore}/10 {qualityTier}</span>
                  {hist ? (
                    <span className="memory-badge">
                      Memory: {Number(hist.sampleCount ?? 0)} Matches · {Number(hist.winRatePct ?? 0)}% Win Rate
                    </span>
                  ) : null}
                </div>
                <span className="kicker" style={{ marginTop: "4px" }}>{strategy}</span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="modal-tabs">
              <button
                type="button"
                className={`modal-tab ${activeTab === "chart" ? "active" : ""}`}
                onClick={() => setActiveTab("chart")}
              >
                📈 Графік OKX (Live)
              </button>
              <button
                type="button"
                className={`modal-tab ${activeTab === "smc" ? "active" : ""}`}
                onClick={() => setActiveTab("smc")}
              >
                🧠 Smart Money & AI
              </button>
              <button
                type="button"
                className={`modal-tab ${activeTab === "targets" ? "active" : ""}`}
                onClick={() => setActiveTab("targets")}
              >
                🎯 Цілі (TP) & Ризик
              </button>
              <button
                type="button"
                className={`modal-tab ${activeTab === "mobile" ? "active" : ""}`}
                onClick={() => setActiveTab("mobile")}
              >
                📱 Для біржі / Телефону
              </button>
              <button
                type="button"
                className={`modal-tab ${activeTab === "vision" ? "active" : ""}`}
                onClick={() => setActiveTab("vision")}
              >
                👁️ Графік (Nemotron 3.5 VL)
              </button>
            </div>

            {/* Modal Body */}
            <div className="modal-body">
              {activeTab === "chart" ? (
                <div className="tab-pane" style={{ padding: 0 }}>
                  <TradingViewChart symbol={symbol} height="440px" interval="15" />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "#0e0b1a", borderTop: "1px solid var(--line)" }}>
                    <span className="mono" style={{ fontSize: "11px", color: "var(--aqua)" }}>
                      ⚡ Bybit Linear Perpetual · Свічки 15m · Стиль OKX / Vexqora
                    </span>
                    <span className="mono" style={{ fontSize: "11px", color: "var(--muted)" }}>
                      Вхід: {entryPrice > 0 ? `$${formatCryptoPrice(entryPrice)}` : "Market"} | SL: ${formatCryptoPrice(stopLoss)} | TP1: ${formatCryptoPrice(tp1?.price ?? 0)}
                    </span>
                  </div>
                </div>
              ) : null}

              {activeTab === "smc" ? (
                <div className="tab-pane">
                  {/* Multi-Timeframe SMC Grid */}
                  <div className="smc-grid">
                    <div className="smc-card">
                      <span className="smc-tag">1D Macro Bias</span>
                      <strong>{opp?.smcAnalysis?.timeframe1D ?? (side === "long" ? "Bullish Institutional Accumulation" : "Bearish Macro Distribution")}</strong>
                    </div>
                    <div className="smc-card">
                      <span className="smc-tag">4H Structure</span>
                      <strong>{opp?.smcAnalysis?.timeframe4H ?? `4H Liquidity targeted at $${tp1?.price ? formatCryptoPrice(tp1.price) : "Target"}`}</strong>
                    </div>
                    <div className="smc-card">
                      <span className="smc-tag">15m Trigger</span>
                      <strong>{opp?.smcAnalysis?.timeframe15M ?? `15m ${side === "long" ? "Bullish CHOCH Reclaim" : "Bearish BOS Breakdown"}`}</strong>
                    </div>
                    <div className="smc-card">
                      <span className="smc-tag negative">Invalidation (SL)</span>
                      <strong className="negative">${formatCryptoPrice(stopLoss)} (-{slPct.toFixed(2)}%)</strong>
                    </div>
                  </div>

                  {/* Nemotron 3 Ultra Reasoning */}
                  <div className="modal-reasoning-box">
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                      <span className="pulse-tag" style={{ color: "var(--aqua)" }}>NEMOTRON 3 ULTRA 550B REASONING</span>
                      <span className="mono" style={{ fontSize: "11px", color: "var(--muted)" }}>Win Prob: {winProb}% · R:R: 1:{rr}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: "13px", lineHeight: "1.6", color: "#e2ddf7" }}>
                      {rationale}
                    </p>
                  </div>
                </div>
              ) : null}

              {activeTab === "targets" ? (
                <div className="tab-pane">
                  {/* Overview Stats */}
                  <div className="ai-setup-grid" style={{ marginBottom: "16px" }}>
                    <div className="ai-setup-item">
                      <span>Вхід (Entry)</span>
                      <strong>{entryPrice > 0 ? `$${formatCryptoPrice(entryPrice)}` : "Market"}</strong>
                    </div>
                    <div className="ai-setup-item">
                      <span>Стоп-лосс (SL)</span>
                      <strong className="negative">{stopLoss > 0 ? `$${formatCryptoPrice(stopLoss)}` : "—"} (-{slPct.toFixed(2)}%)</strong>
                    </div>
                    <div className="ai-setup-item">
                      <span>Win Prob / R:R</span>
                      <strong className="positive">{winProb}% · 1:{rr}</strong>
                    </div>
                    <div className="ai-setup-item">
                      <span>Ризик (Risk)</span>
                      <strong>{riskAmount ? `$${riskAmount}` : "—"} ({riskPct}%)</strong>
                    </div>
                  </div>

                  {/* Take Profit Target Cards */}
                  <div className="ai-targets-section">
                    <div className="ai-targets-header" style={{ marginBottom: "10px" }}>
                      <span className="kicker" style={{ color: "var(--aqua)", fontWeight: "600" }}>
                        🎯 Take Profit Ladder
                      </span>
                      {maxTotalProfit > 0 ? (
                        <span className="mono positive" style={{ fontWeight: "700" }}>
                          Очікуваний прибуток: +${maxTotalProfit.toFixed(2)}
                        </span>
                      ) : null}
                    </div>
                    <div className="ai-targets-grid">
                      {takeProfits.map((tp) => (
                        <div className="ai-target-item" key={tp.idx} style={{ padding: "12px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span className="target-badge">TP {tp.idx}</span>
                            <span style={{ fontSize: "11px", color: "var(--soft-violet)" }}>{tp.sharePct}% позиції</span>
                          </div>
                          <strong className="target-price" style={{ fontSize: "16px", margin: "4px 0" }}>${formatCryptoPrice(tp.price)}</strong>
                          <span className="target-meta positive">
                            +{tp.pctGain}% {tp.estProfit > 0 ? `(+$${tp.estProfit.toFixed(2)})` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTab === "mobile" ? (
                <div className="tab-pane">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                      Скопіюйте готовий текст для ручного відкриття ордера на біржі:
                    </span>
                    <button
                      type="button"
                      className="button secondary"
                      style={{ minHeight: "30px", padding: "0 12px", fontSize: "12px" }}
                      onClick={() => { void copyMobileText(); }}
                    >
                      {copied ? "✓ Скопійовано!" : "📋 Скопіювати текст"}
                    </button>
                  </div>
                  <pre className="signal-pre" style={{ background: "#07050f", padding: "12px", borderRadius: "8px", border: "1px dashed var(--line)" }}>
                    {mobileText}
                  </pre>
                </div>
              ) : null}

              {activeTab === "vision" ? (
                <div className="tab-pane">
                  <div style={{ marginBottom: "12px" }}>
                    <p style={{ margin: "0 0 8px 0", fontSize: "12px", color: "var(--muted)" }}>
                      Завантажте скриншот графіка TradingView для мультимодального аналізу через <strong>Nvidia Nemotron 3.5 Super VL</strong>:
                    </p>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      style={{ fontSize: "12px", color: "var(--muted)" }}
                    />
                  </div>

                  {visionImage ? (
                    <div style={{ marginBottom: "12px", maxHeight: "160px", overflow: "hidden", borderRadius: "8px", border: "1px solid var(--line)" }}>
                      <img src={visionImage} alt="Chart preview" style={{ width: "100%", height: "auto", objectFit: "cover" }} />
                    </div>
                  ) : null}

                  {visionImage ? (
                    <button
                      type="button"
                      className="button primary"
                      style={{ minHeight: "34px", fontSize: "12px", marginBottom: "12px" }}
                      onClick={() => { void runVisionAnalysis(); }}
                      disabled={visionAnalyzing}
                    >
                      {visionAnalyzing ? "🧠 Аналізую графік через Nemotron 3.5 VL…" : "🔍 Запустити візуальний аналіз Nemotron 3.5 VL"}
                    </button>
                  ) : null}

                  {visionResult ? (
                    <div className="modal-reasoning-box" style={{ background: "#110d22" }}>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
                        <span className={`badge ${visionResult.bias === "long" ? "long" : "short"}`}>
                          VISUAL BIAS: {visionResult.bias.toUpperCase()}
                        </span>
                        <span className="ai-score-badge">Впевненість: {visionResult.confidence}%</span>
                        <span className="pulse-tag">{visionResult.timeframeDetected}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: "13px", lineHeight: "1.5", color: "#f1eeff", whiteSpace: "pre-wrap" }}>
                        {visionResult.fullReasoning}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Modal Actions Footer */}
            <div className="modal-footer" style={{ flexDirection: "column", gap: "12px", alignItems: "stretch" }}>
              {/* Sizing & Margin Selector */}
              <div style={{ background: "#0e0b1a", padding: "12px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span className="kicker" style={{ color: "var(--soft-violet)", fontSize: "11px", margin: 0 }}>
                    Сума маржі для входу (Margin USDT):
                  </span>
                  <span className="mono" style={{ fontSize: "12px", color: "var(--text-main)" }}>
                    Позиція з плечем: <strong style={{ color: "var(--aqua)" }}>${notionalPosition.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} USDT</strong> ({leverage}x)
                  </span>
                </div>
                <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", marginBottom: "8px" }}>
                  {[25, 50, 100, 250, 500, 1000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setCustomMargin(amt)}
                      className="ai-chip"
                      style={{
                        border: customMargin === amt ? "1px solid var(--aqua)" : "1px solid var(--line)",
                        background: customMargin === amt ? "rgba(53, 242, 208, 0.15)" : "#171229",
                        color: customMargin === amt ? "var(--aqua)" : "var(--text-main)",
                        fontWeight: customMargin === amt ? "700" : "500",
                        cursor: "pointer",
                        padding: "4px 12px",
                        fontSize: "12px"
                      }}
                    >
                      ${amt}
                    </button>
                  ))}
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginLeft: "auto" }}>
                    <span style={{ fontSize: "11px", color: "var(--muted)" }}>Своя сума:</span>
                    <input
                      type="number"
                      min="5"
                      max="100000"
                      step="5"
                      value={customMargin}
                      onChange={(e) => setCustomMargin(Math.max(1, Number(e.target.value) || 0))}
                      style={{
                        width: "84px",
                        height: "28px",
                        background: "#171229",
                        border: "1px solid var(--line)",
                        borderRadius: "4px",
                        color: "var(--text-main)",
                        padding: "0 6px",
                        fontSize: "12px",
                        textAlign: "right"
                      }}
                    />
                    <span style={{ fontSize: "11px", color: "var(--muted)" }}>USDT</span>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px" }}>
                  <span className="negative mono">Ризик при SL: -${estSlLoss.toFixed(2)}</span>
                  <span className="positive mono">Очікуваний прибуток: +${maxTotalProfit.toFixed(2)}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {signalId ? (
                    <form action={confirmSignal} onSubmit={() => setIsSubmitting(true)}>
                      <input type="hidden" name="signalId" value={signalId} />
                      <input type="hidden" name="margin" value={effectiveMargin} />
                      <button
                        type="submit"
                        className="button primary"
                        disabled={isPending || isSubmitting}
                        style={{ minHeight: "38px", fontSize: "13px", fontWeight: "700" }}
                      >
                        {isSubmitting ? "⏳ Відкриваю позицію..." : `⚡ Увійти в угоду (${effectiveMargin}$ USDT)`}
                      </button>
                    </form>
                  ) : null}

                  {rawSignal && signalId ? (
                    <form action={enhanceSignalAction}>
                      <input type="hidden" name="signalId" value={signalId} />
                      <input type="hidden" name="symbol" value={symbol} />
                      <input type="hidden" name="rawSignal" value={rawSignal} />
                      <input type="hidden" name="rawText" value={rawSignal} />
                      <button
                        type="submit"
                        className="button secondary"
                        disabled={isPending}
                      >
                        ✨ Nemotron Optimize & Tighten SL
                      </button>
                    </form>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setIsModalOpen(false)}
                >
                  Закрити
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
