"use client";

import { useState } from "react";
import type { MarketMicrostructure, MLPredictionResponse, AdaptiveConfidenceResult } from "@crypto-bot/trading";

interface AiEnsembleCardProps {
  symbol: string;
  side: "long" | "short";
  strategy: string;
  rationale: string;
  qualityScore: string;
  qualityTier: string;
  winProbabilityPct?: number;
  mlPrediction: MLPredictionResponse | null;
  microstructure: MarketMicrostructure | null;
  adaptiveAi: AdaptiveConfidenceResult;
}

export function AiEnsembleCard({
  symbol,
  side,
  strategy,
  rationale,
  qualityScore,
  qualityTier,
  mlPrediction,
  microstructure,
  adaptiveAi
}: AiEnsembleCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = side === "long";

  // Gate 1: SMC Structure (Nemotron 3 Ultra)
  const scoreNum = parseFloat(qualityScore) || 7.0;
  const gate1Passed = scoreNum >= 7.0 && adaptiveAi.decision !== "NO_TRADE";

  // Gate 2: Microstructure Flow (OBI + CVD) — P0.8: Missing data is UNKNOWN, not auto-pass
  const hasMicrostructure = microstructure !== null && microstructure !== undefined;
  const obi = microstructure?.orderBook.weightedImbalance ?? 0;
  const cvd = microstructure?.tape.cvdUsd ?? 0;
  const gate2Passed = hasMicrostructure && (isLong ? (obi > -0.30 && cvd >= -100_000) : (obi < 0.30 && cvd <= 100_000));

  // Gate 3: Quantitative ML & Net EV (CatBoost) — P0.8: No fake 14.5 EV or auto-pass on missing model
  const hasRealMl = mlPrediction !== null && !mlPrediction.isFallback && mlPrediction.status === "OK" && mlPrediction.modelType !== "MODEL_UNAVAILABLE";
  const mlWinProb = mlPrediction?.winProbabilityPct ?? 0;
  const mlEV = mlPrediction?.expectedValueUsd ?? 0.0;
  const gate3Passed = hasRealMl && mlPrediction.decision === "TRADE" && mlEV > 0;

  // Gate 4: Capital Preservation Risk Engine
  const gate4Passed = !adaptiveAi.isHighRisk && adaptiveAi.decision !== "NO_TRADE";

  const gates = [
    {
      id: "smc",
      title: "1. SMC Структура (Nemotron 3 Ultra)",
      passed: gate1Passed,
      badge: gate1Passed ? "СХВАЛЕНО" : "УВАГА",
      color: gate1Passed ? "#35F2D0" : "#FFC24B",
      detail: gate1Passed
        ? `${rationale || strategy} (Оцінка якості: ${qualityScore}/10 ${qualityTier}).`
        : `Підвищений ризик структури: ${adaptiveAi.rejectionReason || "Зсув рівнів ліквідності"}.`
    },
    {
      id: "microstructure",
      title: "2. Мікроструктура та CVD (Bybit Tape)",
      passed: gate2Passed,
      badge: !hasMicrostructure ? "НЕМАЄ ДАНИХ" : gate2Passed ? "СХВАЛЕНО" : "СУПЕРЕЧНІСТЬ",
      color: !hasMicrostructure ? "#8A82A5" : gate2Passed ? "#35F2D0" : "#FF4F9A",
      detail: hasMicrostructure
        ? `OBI: ${obi >= 0 ? "+" : ""}${(obi * 100).toFixed(1)}% · CVD: ${cvd >= 0 ? "+" : ""}$${Math.round(cvd).toLocaleString()} · Китів: ${microstructure.tape.whaleTradesCount} блоків (${microstructure.regime.toUpperCase()}).`
        : "Біржовий стакан та потік угод недоступні (UNKNOWN). Немає підтвердження мікроструктури."
    },
    {
      id: "ml",
      title: "3. Квантовий ML-фільтр (CatBoost + FreqAI)",
      passed: gate3Passed,
      badge: !hasRealMl ? "НЕДОСТУПНО" : gate3Passed ? "ПОЗИТИВНЕ EV" : "НЕГАТИВНЕ EV",
      color: !hasRealMl ? "#8A82A5" : gate3Passed ? "#35F2D0" : "#FF4F9A",
      detail: hasRealMl
        ? `P(TP перед SL) = ${mlWinProb.toFixed(1)}% · Чисте EV: ${mlEV >= 0 ? "+" : ""}$${mlEV.toFixed(2)} (після комісій Bybit 0.11%) [${mlPrediction.modelType}].`
        : mlPrediction?.isFallback
        ? `ML-модель недоступна (${mlPrediction.rejectionReason || "сервіс офлайн"}). Захисний режим NO_TRADE.`
        : "Дані ML-моделі відсутні. Фіктивні оцінки заборонено (P0.8)."
    },
    {
      id: "risk",
      title: "4. Незалежний Ризик-Двигун",
      passed: gate4Passed,
      badge: gate4Passed ? "ЗАХИЩЕНО" : "NO TRADE",
      color: gate4Passed ? "#35F2D0" : "#FF4F9A",
      detail: gate4Passed
        ? `1% Trailing Stop активується після TP1. Обмеження просадки дотримано. Позиція розрахована від ризику.`
        : `Ризик-двигун заблокував сигнал: ${adaptiveAi.rejectionReason || "Перевищено допустимий поріг ризику"}.`
    }
  ];

  const totalPassed = gates.filter((g) => g.passed).length;
  const ensembleBadge = totalPassed === 4
    ? { text: "4/4 GATES PASSED · STRONG QUANT EDGE", bg: "rgba(53, 242, 208, 0.12)", border: "#35F2D0", color: "#35F2D0" }
    : totalPassed === 3
    ? { text: "3/4 GATES PASSED · MODERATE EDGE", bg: "rgba(255, 194, 75, 0.12)", border: "#FFC24B", color: "#FFC24B" }
    : { text: `${totalPassed}/4 GATES · CAPITAL PROTECTION (NO TRADE)`, bg: "rgba(255, 79, 154, 0.12)", border: "#FF4F9A", color: "#FF4F9A" };

  return (
    <div
      className="cd"
      style={{
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
        background: "linear-gradient(180deg, #120D24 0%, #0E0B1A 100%)",
        border: "1px solid #2A2145"
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "16px" }}>⚡</span>
          <div>
            <div style={{ font: "700 15px 'Plus Jakarta Sans', sans-serif", color: "#F1EEFF", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>Vexqora AI Decision Ensemble</span>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: "6px",
                  background: ensembleBadge.bg,
                  color: ensembleBadge.color,
                  border: `1px solid ${ensembleBadge.border}`,
                  letterSpacing: "0.5px"
                }}
              >
                {ensembleBadge.text}
              </span>
            </div>
            <div style={{ font: "400 12px Inter, sans-serif", color: "#A59CC4", marginTop: "2px" }}>
              4 незалежні рівні валідації: Структура → Мікроструктура → ML-сподівання (EV) → Ризик-контроль
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          style={{
            background: "transparent",
            border: "1px solid #2A2145",
            borderRadius: "6px",
            color: "#A59CC4",
            padding: "4px 10px",
            fontSize: "12px",
            cursor: "pointer",
            fontFamily: "Inter, sans-serif"
          }}
        >
          {expanded ? "Згорнути деталі ▲" : "Всі 4 рівні ▼"}
        </button>
      </div>

      {/* Grid of 4 Gates */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: expanded ? "1fr" : "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "10px"
        }}
      >
        {gates.map((gate) => (
          <div
            key={gate.id}
            style={{
              padding: "12px 14px",
              borderRadius: "8px",
              background: "#171229",
              border: `1px solid ${gate.passed ? "rgba(53, 242, 208, 0.25)" : "rgba(255, 79, 154, 0.25)"}`,
              display: "flex",
              flexDirection: "column",
              gap: "6px"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
              <span style={{ font: "600 13px 'Plus Jakarta Sans', sans-serif", color: "#F1EEFF" }}>
                {gate.title}
              </span>
              <span
                style={{
                  font: "700 10px 'JetBrains Mono', monospace",
                  padding: "1px 6px",
                  borderRadius: "4px",
                  background: gate.passed ? "rgba(53, 242, 208, 0.15)" : "rgba(255, 79, 154, 0.15)",
                  color: gate.color,
                  border: `1px solid ${gate.color}40`
                }}
              >
                {gate.badge}
              </span>
            </div>
            <div style={{ font: "400 12px Inter, sans-serif", color: "#A59CC4", lineHeight: 1.4 }}>
              {gate.detail}
            </div>
          </div>
        ))}
      </div>

      {/* Verdict Footer */}
      <div
        style={{
          padding: "10px 14px",
          borderRadius: "8px",
          background: totalPassed >= 3 ? "rgba(53, 242, 208, 0.05)" : "rgba(255, 79, 154, 0.05)",
          border: `1px solid ${totalPassed >= 3 ? "rgba(53, 242, 208, 0.2)" : "rgba(255, 79, 154, 0.2)"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "10px"
        }}
      >
        <div style={{ font: "500 12px Inter, sans-serif", color: totalPassed >= 3 ? "#35F2D0" : "#FF4F9A" }}>
          {totalPassed === 4
            ? `✅ Ідеальне співпадіння ансамблю ШІ для ${symbol}: математичне сподівання позитивне, стрічка ордерів підтверджує рух, ризик строго обмежений.`
            : totalPassed === 3
            ? `⚠️ Помірний сетап для ${symbol}: 3 з 4 фільтрів схвалені. Вхід допустимий із суворим дотриманням Stop Loss.`
            : `⛔ Вхід відхилено ансамблем ШІ (NO_TRADE): відсутній статистичний edge або біржові комісії з'їдають прибуток. Капітал захищено.`}
        </div>
      </div>
    </div>
  );
}
