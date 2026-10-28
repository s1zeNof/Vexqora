"use client";

import { useState, useTransition, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCryptoPrice } from "../../../lib/format";
import { PixelDroneMascot, type DronePhase } from "../../../components/pixel-drone-mascot";
import { executeCopilotSetupAction } from "./actions";
import type { CopilotAnalystResult, CopilotTradeScenario } from "@crypto-bot/trading";

interface CopilotInterfaceProps {
  initialAvailableBalance: number;
  activeAccountLabel: string;
  isPaper: boolean;
}

const QUICK_PROMPTS = [
  "Маю 15$ але хочу увійти в монету SOL проаналізуй різні випадку входу та TP/SL",
  "BTC: чи безпечно відкривати лонг прямо зараз і де найближчий стоп?",
  "ETH: підбери найкращий скальп-сетап під мій поточний баланс",
  "DOGE: порівняй лімітний вхід на відкаті проти входу по ринку",
  "SUI: проаналізуй стакан та розрахуй безпечні TP/SL рівні"
];

export function CopilotInterface({
  initialAvailableBalance,
  activeAccountLabel,
  isPaper
}: CopilotInterfaceProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [balanceInput, setBalanceInput] = useState(
    initialAvailableBalance > 0 ? initialAvailableBalance.toFixed(2) : "15.00"
  );
  const [isLoading, setIsLoading] = useState(false);
  const [dronePhase, setDronePhase] = useState<DronePhase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<CopilotAnalystResult | null>(null);
  const [executionState, setExecutionState] = useState<{
    scenarioId: string;
    isExecuting: boolean;
    successMessage?: string;
    errorMessage?: string;
  } | null>(null);

  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleUseFullBalance = () => {
    if (initialAvailableBalance > 0) {
      setBalanceInput(initialAvailableBalance.toFixed(2));
      const textToAppend = ` (маю ${initialAvailableBalance.toFixed(2)}$)`;
      if (!query.includes("$")) {
        setQuery((prev) => `${prev.trim()}${textToAppend}`);
      }
    }
  };

  const handleSelectQuickPrompt = (promptText: string) => {
    setQuery(promptText);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const promptToSend = query.trim();
    if (!promptToSend || isLoading) return;

    setErrorMsg(null);
    setExecutionState(null);
    setIsLoading(true);
    setDronePhase("entering");

    const parsedBalance = parseFloat(balanceInput);
    const customBalance = !isNaN(parsedBalance) && parsedBalance > 0 ? parsedBalance : undefined;

    // Transition drone to thinking
    const timer = setTimeout(() => {
      setDronePhase("thinking");
    }, 2800);

    try {
      const res = await fetch("/api/ai/copilot-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: promptToSend,
          customBalance
        })
      });

      const data = (await res.json()) as CopilotAnalystResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Не вдалося отримати аналіз від ШІ");
      }

      // Exit drone smoothly
      clearTimeout(timer);
      setDronePhase("exiting");
      setTimeout(() => {
        setDronePhase("idle");
        setCurrentResult(data);
        setIsLoading(false);
      }, 2200);
    } catch (err) {
      clearTimeout(timer);
      setDronePhase("idle");
      setIsLoading(false);
      setErrorMsg(err instanceof Error ? err.message : "Помилка зв'язку з аналітичним ядром");
    }
  };

  const handleExecuteScenario = (scenario: CopilotTradeScenario) => {
    if (!currentResult) return;
    setExecutionState({ scenarioId: scenario.id, isExecuting: true });

    startTransition(async () => {
      try {
        const res = await executeCopilotSetupAction({
          symbol: currentResult.detectedSymbol,
          side: scenario.side,
          orderType: scenario.orderType,
          entryPrice: scenario.entryPrice,
          stopLoss: scenario.stopLoss,
          tp1: scenario.tp1,
          tp2: scenario.tp2,
          tp3: scenario.tp3,
          leverage: scenario.leverage,
          allocatedMarginUsdt: scenario.allocatedMarginUsdt
        });

        setExecutionState({
          scenarioId: scenario.id,
          isExecuting: false,
          successMessage: res.message
        });
        router.refresh();
      } catch (err) {
        setExecutionState({
          scenarioId: scenario.id,
          isExecuting: false,
          errorMessage: err instanceof Error ? err.message : "Помилка виконання ордера"
        });
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%", maxWidth: "1280px", margin: "0 auto", paddingBottom: "60px" }}>
      {/* Header Bar */}
      <div
        className="cd"
        style={{
          padding: "20px 24px",
          background: "linear-gradient(180deg, #120D24 0%, #0E0B1A 100%)",
          borderColor: "#2A2145",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px"
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "20px" }}>🧠</span>
            <h1 style={{ margin: 0, font: "700 22px 'Plus Jakarta Sans', sans-serif", color: "#F1EEFF" }}>
              Vexqora AI Copilot
            </h1>
            <span
              style={{
                background: "rgba(124, 77, 255, 0.15)",
                border: "1px solid #7C4DFF",
                color: "#B9A2FF",
                padding: "2px 8px",
                borderRadius: "12px",
                font: "600 11px 'JetBrains Mono', monospace"
              }}
            >
              MULTI-SCENARIO ENGINE
            </span>
          </div>
          <p className="lb" style={{ margin: "6px 0 0 0", color: "#A59CC4", fontSize: "13px" }}>
            Поставте будь-яке запитання або вкажіть суму та актив — ШІ проаналізує стакан, тренд та розрахує найкращий вхід із точними TP/SL.
          </p>
        </div>

        {/* Balance & Account Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div
            style={{
              background: "#171229",
              border: "1px solid #2A2145",
              borderRadius: "8px",
              padding: "8px 14px",
              display: "flex",
              flexDirection: "column",
              gap: "2px"
            }}
          >
            <span style={{ font: "400 11px Inter, sans-serif", color: "#8A82A5" }}>
              Акаунт: {activeAccountLabel} {isPaper ? "(Virtual)" : "(Live)"}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ font: "700 15px 'JetBrains Mono', monospace", color: "#35F2D0" }}>
                ${initialAvailableBalance > 0 ? initialAvailableBalance.toFixed(2) : "0.00"} USDT
              </span>
              {initialAvailableBalance > 0 && (
                <button
                  type="button"
                  onClick={handleUseFullBalance}
                  className="tab"
                  style={{
                    padding: "2px 6px",
                    fontSize: "10px",
                    background: "#2A2145",
                    border: "none",
                    borderRadius: "4px",
                    color: "#FFFFFF",
                    cursor: "pointer"
                  }}
                  title="Використати весь доступний баланс у запиті"
                >
                  Всі кошти
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Prompt Section */}
      <div
        className="cd"
        style={{
          padding: "24px",
          background: "#0E0B1A",
          borderColor: "#2A2145",
          display: "flex",
          flexDirection: "column",
          gap: "16px"
        }}
      >
        <form onSubmit={(e) => { void handleSubmit(e); }} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <label style={{ font: "600 13px 'Plus Jakarta Sans', sans-serif", color: "#F1EEFF" }}>
            💬 Ваш запит до торгового ШІ:
          </label>
          <div style={{ position: "relative" }}>
            <textarea
              ref={textareaRef}
              rows={3}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="Наприклад: Маю 15$ але хочу увійти в монету SOL проаналізуй різні випадку входу та TP/SL або будь-яке інше питання..."
              style={{
                width: "100%",
                background: "#171229",
                border: "1px solid #2A2145",
                borderRadius: "10px",
                padding: "14px 16px",
                color: "#FFFFFF",
                fontSize: "14px",
                fontFamily: "Inter, sans-serif",
                lineHeight: "1.5",
                resize: "vertical",
                outline: "none"
              }}
              disabled={isLoading}
            />
          </div>

          {/* Controls Bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "12px", color: "#A59CC4" }}>Депозит для розрахунку:</span>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <input
                  type="number"
                  min="0.1"
                  step="any"
                  value={balanceInput}
                  onChange={(e) => setBalanceInput(e.target.value)}
                  style={{
                    width: "85px",
                    background: "#171229",
                    border: "1px solid #2A2145",
                    borderRadius: "6px",
                    padding: "6px 8px",
                    color: "#FFFFFF",
                    font: "600 13px 'JetBrains Mono', monospace",
                    textAlign: "right"
                  }}
                  disabled={isLoading}
                />
                <span style={{ fontSize: "12px", color: "#8A82A5", fontFamily: "'JetBrains Mono', monospace" }}>USDT</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="bt pr"
              style={{
                padding: "10px 24px",
                font: "600 14px 'Plus Jakarta Sans', sans-serif",
                background: "linear-gradient(135deg, #7C4DFF 0%, #B24BFF 100%)",
                border: "none",
                borderRadius: "8px",
                color: "#FFFFFF",
                cursor: isLoading ? "not-allowed" : "pointer",
                opacity: isLoading || !query.trim() ? 0.6 : 1,
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}
            >
              {isLoading ? "⚡ Аналізую ринок..." : "Проаналізувати та знайти сетап 🚀"}
            </button>
          </div>
        </form>

        {/* Quick Suggestion Chips */}
        <div>
          <div style={{ font: "500 11.5px Inter, sans-serif", color: "#8A82A5", marginBottom: "8px" }}>
            ⚡ Швидкі приклади (клікніть для підстановки):
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {QUICK_PROMPTS.map((p, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSelectQuickPrompt(p)}
                style={{
                  background: "#171229",
                  border: "1px solid #2A2145",
                  borderRadius: "6px",
                  padding: "5px 10px",
                  color: "#B9A2FF",
                  fontSize: "12px",
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "background 0.15s, border-color 0.15s"
                }}
                disabled={isLoading}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Error Notification */}
        {errorMsg && (
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(255, 79, 154, 0.1)",
              border: "1px solid #FF4F9A",
              borderRadius: "8px",
              color: "#FF4F9A",
              fontSize: "13px"
            }}
          >
            ⚠️ {errorMsg}
          </div>
        )}
      </div>

      {/* Loading State with Pixel Drone Mascot */}
      {isLoading && (
        <div
          className="cd"
          style={{
            padding: "40px 20px",
            background: "#0E0B1A",
            borderColor: "#2A2145",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "16px",
            minHeight: "260px"
          }}
        >
          <PixelDroneMascot
            phase={dronePhase}
            statusText="ШІ Vexqora аналізує біржовий стакан, OBI та прораховує 3 сценарії входу..."
            width={130}
            height={108}
          />
          <div style={{ textAlign: "center", maxWidth: "420px" }}>
            <div style={{ font: "600 14px 'Plus Jakarta Sans', sans-serif", color: "#F1EEFF" }}>
              Обробка ринкових даних у реальному часі
            </div>
            <p style={{ margin: "4px 0 0 0", font: "400 12px Inter, sans-serif", color: "#8A82A5" }}>
              Збираємо актуальний тікер, глибину стакана (Order Book Imbalance), 15m RSI та розраховуємо математичний Risk/Reward під ваш депозит.
            </p>
          </div>
        </div>
      )}

      {/* Analysis Results View */}
      {currentResult && !isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Market Overview Card */}
          <div
            className="cd"
            style={{
              padding: "18px 24px",
              background: "#171229",
              borderColor: "#2A2145",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "16px"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <div style={{ font: "700 20px 'JetBrains Mono', monospace", color: "#FFFFFF" }}>
                {currentResult.detectedSymbol}
              </div>
              <div style={{ font: "700 20px 'JetBrains Mono', monospace", color: "#35F2D0" }}>
                ${formatCryptoPrice(currentResult.marketData.currentPrice)}
              </div>
              <div
                style={{
                  font: "600 13px 'JetBrains Mono', monospace",
                  color: currentResult.marketData.price24hPcnt >= 0 ? "#35F2D0" : "#FF4F9A",
                  background: currentResult.marketData.price24hPcnt >= 0 ? "rgba(53, 242, 208, 0.1)" : "rgba(255, 79, 154, 0.1)",
                  padding: "2px 8px",
                  borderRadius: "4px"
                }}
              >
                {currentResult.marketData.price24hPcnt >= 0 ? "+" : ""}{currentResult.marketData.price24hPcnt}%
              </div>
            </div>

            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", fontSize: "12px", color: "#A59CC4" }}>
              <div>
                <span style={{ color: "#8A82A5" }}>24h High:</span> ${formatCryptoPrice(currentResult.marketData.high24h)}
              </div>
              <div>
                <span style={{ color: "#8A82A5" }}>24h Low:</span> ${formatCryptoPrice(currentResult.marketData.low24h)}
              </div>
              <div>
                <span style={{ color: "#8A82A5" }}>OBI:</span>{" "}
                <span style={{ color: (currentResult.marketData.orderBookImbalancePct ?? 0) >= 0 ? "#35F2D0" : "#FF4F9A" }}>
                  {currentResult.marketData.orderBookImbalancePct !== null ? `${currentResult.marketData.orderBookImbalancePct > 0 ? "+" : ""}${currentResult.marketData.orderBookImbalancePct}%` : "—"}
                </span>
              </div>
              <div>
                <span style={{ color: "#8A82A5" }}>15m RSI:</span> {currentResult.marketData.rsi15m}/100
              </div>
              <div>
                <span style={{ color: "#8A82A5" }}>Бюджет:</span>{" "}
                <span style={{ color: "#F1EEFF", fontWeight: 600 }}>${currentResult.detectedBudget.toFixed(2)} USDT</span>
              </div>
            </div>
          </div>

          {/* AI Comprehensive Analysis Card */}
          <div
            className="cd"
            style={{
              padding: "24px",
              background: "#0E0B1A",
              borderColor: "#2A2145"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
              <span style={{ fontSize: "18px" }}>📋</span>
              <h2 style={{ margin: 0, font: "700 18px 'Plus Jakarta Sans', sans-serif", color: "#F1EEFF" }}>
                {currentResult.aiAnalysis.title}
              </h2>
            </div>

            <div
              style={{
                color: "#E2DCFA",
                fontSize: "14px",
                lineHeight: "1.7",
                whiteSpace: "pre-wrap",
                fontFamily: "Inter, sans-serif"
              }}
            >
              {currentResult.aiAnalysis.fullMarkdownText}
            </div>
          </div>

          {/* Execution Alert (Toast/Banner) */}
          {executionState?.successMessage && (
            <div
              style={{
                padding: "16px 20px",
                background: "rgba(53, 242, 208, 0.12)",
                border: "1px solid #35F2D0",
                borderRadius: "8px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "12px",
                flexWrap: "wrap"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#35F2D0", fontWeight: 600 }}>
                <span>✅</span>
                <span>{executionState.successMessage}</span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <Link href="/dashboard/positions" className="bt sm pr" style={{ textDecoration: "none" }}>
                  Переглянути в позиціях →
                </Link>
                <Link href={`/dashboard/signal/${currentResult.detectedSymbol}`} className="bt sm" style={{ textDecoration: "none" }}>
                  Відкрити термінал 📊
                </Link>
              </div>
            </div>
          )}

          {executionState?.errorMessage && (
            <div
              style={{
                padding: "14px 18px",
                background: "rgba(255, 79, 154, 0.12)",
                border: "1px solid #FF4F9A",
                borderRadius: "8px",
                color: "#FF4F9A"
              }}
            >
              ⚠️ {executionState.errorMessage}
            </div>
          )}

          {/* 3 Actionable Scenarios Grid */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
              <h3 style={{ margin: 0, font: "700 17px 'Plus Jakarta Sans', sans-serif", color: "#F1EEFF" }}>
                🎯 Порівняння 3 сценаріїв угоди (депозит: ${currentResult.detectedBudget.toFixed(2)} USDT)
              </h3>
              <span style={{ fontSize: "12px", color: "#8A82A5" }}>
                Оберіть оптимальний сценарій та виконайте в 1 клік
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
              {currentResult.scenarios.map((sc) => {
                const isWinner = sc.id === currentResult.aiAnalysis.bestScenarioId;
                const isLong = sc.side === "long";
                const isCurrentlyExecuting = executionState?.scenarioId === sc.id && executionState?.isExecuting;

                return (
                  <div
                    key={sc.id}
                    className="cd"
                    style={{
                      padding: "20px",
                      background: isWinner ? "linear-gradient(180deg, #181231 0%, #0E0B1A 100%)" : "#0E0B1A",
                      border: isWinner ? "2px solid #7C4DFF" : "1px solid #2A2145",
                      borderRadius: "12px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: "16px",
                      boxShadow: isWinner ? "0 0 20px rgba(124, 77, 255, 0.2)" : "none"
                    }}
                  >
                    <div>
                      {/* Top Header */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", marginBottom: "8px" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span
                              style={{
                                font: "700 11px 'JetBrains Mono', monospace",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                background: isLong ? "rgba(53, 242, 208, 0.15)" : "rgba(255, 79, 154, 0.15)",
                                color: isLong ? "#35F2D0" : "#FF4F9A",
                                border: `1px solid ${isLong ? "#35F2D0" : "#FF4F9A"}`
                              }}
                            >
                              {sc.side.toUpperCase()} · {sc.orderType.toUpperCase()}
                            </span>
                            <span style={{ fontSize: "11px", color: "#B9A2FF", font: "600 11px Inter, sans-serif" }}>
                              {sc.badge}
                            </span>
                          </div>
                          <h4 style={{ margin: "6px 0 0 0", font: "700 15px 'Plus Jakarta Sans', sans-serif", color: "#F1EEFF" }}>
                            {sc.name}
                          </h4>
                        </div>

                        {isWinner && (
                          <span
                            style={{
                              background: "linear-gradient(135deg, #7C4DFF 0%, #B24BFF 100%)",
                              color: "#FFFFFF",
                              font: "700 10px 'JetBrains Mono', monospace",
                              padding: "3px 8px",
                              borderRadius: "12px",
                              whiteSpace: "nowrap"
                            }}
                          >
                            ⭐ РЕКОМЕНДОВАНО
                          </span>
                        )}
                      </div>

                      {/* Thesis */}
                      <p style={{ margin: "0 0 14px 0", font: "400 12px Inter, sans-serif", color: "#A59CC4", lineHeight: "1.4" }}>
                        {sc.thesis}
                      </p>

                      {/* Levels Breakdown */}
                      <div
                        style={{
                          background: "#171229",
                          border: "1px solid #2A2145",
                          borderRadius: "8px",
                          padding: "12px 14px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                          fontSize: "12px",
                          fontFamily: "'JetBrains Mono', monospace"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#8A82A5" }}>Вхід ({sc.orderType}):</span>
                          <span style={{ color: "#FFFFFF", fontWeight: 600 }}>${formatCryptoPrice(sc.entryPrice)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#FF4F9A" }}>Stop Loss (-{sc.slDistancePct}%):</span>
                          <span style={{ color: "#FF4F9A", fontWeight: 600 }}>${formatCryptoPrice(sc.stopLoss)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#35F2D0" }}>TP1 (40%):</span>
                          <span style={{ color: "#35F2D0", fontWeight: 600 }}>${formatCryptoPrice(sc.tp1)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#35F2D0" }}>TP2 (35%):</span>
                          <span style={{ color: "#35F2D0" }}>${formatCryptoPrice(sc.tp2)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "#35F2D0" }}>TP3 (25%):</span>
                          <span style={{ color: "#35F2D0" }}>${formatCryptoPrice(sc.tp3)}</span>
                        </div>
                      </div>

                      {/* Math & Sizing Box */}
                      <div
                        style={{
                          marginTop: "10px",
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: "8px",
                          fontSize: "11px",
                          fontFamily: "'JetBrains Mono', monospace"
                        }}
                      >
                        <div style={{ background: "rgba(255, 79, 154, 0.08)", border: "1px solid rgba(255, 79, 154, 0.2)", borderRadius: "6px", padding: "6px 8px" }}>
                          <div style={{ color: "#8A82A5" }}>Макс. збиток:</div>
                          <div style={{ color: "#FF4F9A", fontWeight: 700, fontSize: "12px" }}>-${sc.maxLossUsdt} USDT</div>
                        </div>
                        <div style={{ background: "rgba(53, 242, 208, 0.08)", border: "1px solid rgba(53, 242, 208, 0.2)", borderRadius: "6px", padding: "6px 8px" }}>
                          <div style={{ color: "#8A82A5" }}>Цільовий профіт:</div>
                          <div style={{ color: "#35F2D0", fontWeight: 700, fontSize: "12px" }}>+${sc.targetGainUsdt} USDT</div>
                        </div>
                        <div style={{ background: "#171229", border: "1px solid #2A2145", borderRadius: "6px", padding: "6px 8px" }}>
                          <div style={{ color: "#8A82A5" }}>Risk / Reward:</div>
                          <div style={{ color: "#F1EEFF", fontWeight: 600 }}>1:{sc.riskRewardRatio}</div>
                        </div>
                        <div style={{ background: "#171229", border: "1px solid #2A2145", borderRadius: "6px", padding: "6px 8px" }}>
                          <div style={{ color: "#8A82A5" }}>Плече / Маржа:</div>
                          <div style={{ color: "#F1EEFF", fontWeight: 600 }}>{sc.leverage}x · ${sc.allocatedMarginUsdt}</div>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
                      <button
                        type="button"
                        onClick={() => handleExecuteScenario(sc)}
                        disabled={isPending || isCurrentlyExecuting}
                        className="bt pr"
                        style={{
                          width: "100%",
                          padding: "10px",
                          fontSize: "13px",
                          fontFamily: "'Plus Jakarta Sans', sans-serif",
                          fontWeight: 600,
                          background: isWinner
                            ? "linear-gradient(135deg, #7C4DFF 0%, #B24BFF 100%)"
                            : "#2A2145",
                          border: "none",
                          borderRadius: "8px",
                          color: "#FFFFFF",
                          cursor: isCurrentlyExecuting ? "not-allowed" : "pointer",
                          opacity: isCurrentlyExecuting ? 0.6 : 1
                        }}
                      >
                        {isCurrentlyExecuting ? "⚡ Відкриваю..." : `🚀 Відкрити позицію ($${sc.allocatedMarginUsdt.toFixed(2)})`}
                      </button>

                      <Link
                        href={`/dashboard/signal/${currentResult.detectedSymbol}`}
                        className="bt sm"
                        style={{
                          width: "100%",
                          textAlign: "center",
                          textDecoration: "none",
                          fontSize: "12px",
                          padding: "6px",
                          background: "transparent",
                          border: "1px solid #2A2145",
                          borderRadius: "6px",
                          color: "#A59CC4"
                        }}
                      >
                        📊 Відкрити графік у терміналі →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
