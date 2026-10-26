"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface ScanModalButtonProps {
  symbol?: string;
  filter?: "balanced" | "moderate" | "momentum" | "volatile";
  buttonText?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function ScanModalButton({
  symbol = "UNIVERSE",
  filter = "balanced",
  buttonText = "⚡ Сканувати Bybit 916 пар",
  className = "bt pr",
  style
}: ScanModalButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scannedPairs, setScannedPairs] = useState(0);
  const [currentStep, setCurrentStep] = useState(1);
  const [remainingSeconds, setRemainingSeconds] = useState(7);
  const [result, setResult] = useState<{
    success: boolean;
    count: number;
    symbols: string[];
    error?: string;
  } | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isUniverse = symbol === "UNIVERSE" || symbol === "ALL" || symbol === "MODERATE" || symbol === "ПОМІРНІ";
  const targetTotal = isUniverse ? 916 : 1;

  const startScan = async () => {
    setIsOpen(true);
    setIsScanning(true);
    setProgress(5);
    setScannedPairs(isUniverse ? 48 : 0);
    setCurrentStep(1);
    setRemainingSeconds(7);
    setResult(null);

    const startTime = Date.now();
    const expectedDurationMs = 6500;

    // Start progress simulation interval
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const ratio = Math.min(0.92, elapsed / expectedDurationMs);

      // Smooth progress curve
      const currentProg = Math.round(ratio * 100);
      setProgress(Math.max(5, currentProg));

      if (isUniverse) {
        const pairs = Math.min(916, Math.round(ratio * 916));
        setScannedPairs(pairs);
      }

      // Step indicator
      if (currentProg < 25) {
        setCurrentStep(1);
      } else if (currentProg < 55) {
        setCurrentStep(2);
      } else if (currentProg < 80) {
        setCurrentStep(3);
      } else {
        setCurrentStep(4);
      }

      const leftSec = Math.max(1, Math.round((expectedDurationMs - elapsed) / 1000));
      setRemainingSeconds(leftSec);
    }, 200);

    try {
      const res = await fetch("/api/market/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, filter })
      });

      const data = (await res.json()) as {
        success?: boolean;
        count?: number;
        symbols?: string[];
        error?: string;
      };

      if (timerRef.current) clearInterval(timerRef.current);

      if (res.ok && data.success) {
        setProgress(100);
        setScannedPairs(targetTotal);
        setCurrentStep(5);
        setResult({
          success: true,
          count: data.count ?? 0,
          symbols: data.symbols ?? []
        });

        // Trigger Next.js server component re-fetch
        router.refresh();

        // Auto close after 1.8s
        setTimeout(() => {
          setIsOpen(false);
          setIsScanning(false);
        }, 1800);
      } else {
        setProgress(100);
        setResult({
          success: false,
          count: 0,
          symbols: [],
          error: data.error || "Помилка при скануванні ринку"
        });
        setIsScanning(false);
      }
    } catch (err) {
      if (timerRef.current) clearInterval(timerRef.current);
      setProgress(100);
      setResult({
        success: false,
        count: 0,
        symbols: [],
        error: err instanceof Error ? err.message : "Не вдалося з'єднатися із сервером"
      });
      setIsScanning(false);
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const steps = [
    {
      num: 1,
      title: isUniverse ? "Підключення до Bybit Linear REST & WS (916 пар)" : `Отримання котирувань для ${symbol}`,
      desc: "Отримання стакану ордерів та тикерів безстрокових деривативів"
    },
    {
      num: 2,
      title: "Аналіз ліквідності та фільтрація об'ємів 24h",
      desc: "Відбір помірних ліквідних пар і трендових імпульсів"
    },
    {
      num: 3,
      title: "ШІ-аналіз Nemotron Ultra: перевірка Smart Money ліквідності",
      desc: "Пошук FVG, Imbalance, рівнів підтримки та зняття стопів"
    },
    {
      num: 4,
      title: "Розрахунок безпечного ризику (SL та TP1–TP3)",
      desc: "Математичне визначення R:R та публікація в стрічку"
    }
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void startScan();
        }}
        disabled={isScanning}
        className={className}
        style={{
          height: "40px",
          fontSize: "14px",
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          cursor: isScanning ? "wait" : "pointer",
          ...style
        }}
        title={isUniverse ? "Сканувати 916 пар ринку Bybit із збалансованим відбором" : `Просканувати ${symbol} на Bybit`}
      >
        <span>{buttonText}</span>
      </button>

      {/* High-Tech Animated Modal Overlay */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px"
          }}
        >
          <div
            style={{
              background: "#0E0B1A",
              border: "1px solid #2A2145",
              borderRadius: "16px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 30px rgba(124, 77, 255, 0.15)",
              maxWidth: "520px",
              width: "100%",
              padding: "24px",
              color: "#FFFFFF",
              position: "relative",
              overflow: "hidden"
            }}
          >
            {/* Top decorative gradient line */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: "3px",
                background: "linear-gradient(90deg, #7C4DFF 0%, #B24BFF 50%, #35F2D0 100%)"
              }}
            />

            {/* Header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "16px" }}>
              <div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "rgba(124, 77, 255, 0.15)", padding: "3px 8px", borderRadius: "6px", border: "1px solid rgba(124, 77, 255, 0.3)", marginBottom: "8px" }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#35F2D0", display: "inline-block", boxShadow: "0 0 6px #35F2D0" }} />
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#B9A2FF", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                    Vexqora Nemotron Ultra AI
                  </span>
                </div>
                <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#FFFFFF" }}>
                  {isUniverse ? "⚡ Сканування ринку Bybit Linear" : `⚡ Аналіз котирувань ${symbol}`}
                </h3>
                <div style={{ fontSize: "12px", color: "#A59CC4", marginTop: "2px" }}>
                  Пошук інституційних сетапів з високою ймовірністю відпрацювання
                </div>
              </div>

              {!isScanning && (
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#8E88A8",
                    fontSize: "20px",
                    cursor: "pointer",
                    padding: "4px"
                  }}
                  title="Закрити"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Live Progress Box */}
            <div
              style={{
                background: "#171229",
                border: "1px solid #2A2145",
                borderRadius: "12px",
                padding: "16px",
                marginBottom: "20px"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ fontSize: "13px", color: "#F1EEFF", fontWeight: 600 }}>
                  {isUniverse ? "Перевірено пар Bybit:" : "Аналіз пари:"}
                </span>
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "#35F2D0",
                    fontFamily: "var(--font-mono), monospace",
                    fontVariantNumeric: "tabular-nums"
                  }}
                >
                  {isUniverse ? `${scannedPairs} / ${targetTotal} пар` : `${progress}%`}
                </span>
              </div>

              {/* Progress bar container */}
              <div
                style={{
                  height: "8px",
                  background: "#07050F",
                  borderRadius: "4px",
                  overflow: "hidden",
                  position: "relative"
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${progress}%`,
                    background: "linear-gradient(90deg, #7C4DFF 0%, #B24BFF 60%, #35F2D0 100%)",
                    borderRadius: "4px",
                    transition: "width 0.25s ease-out",
                    boxShadow: "0 0 10px rgba(53, 242, 208, 0.5)"
                  }}
                />
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "8px", fontSize: "12px", color: "#A59CC4" }}>
                <span>Прогрес: {progress}%</span>
                <span>
                  {result
                    ? result.success
                      ? "✅ Завершено!"
                      : "❌ Помилка"
                    : `Очікувано: ~${remainingSeconds} сек`}
                </span>
              </div>
            </div>

            {/* Steps Checklist */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
              {steps.map((st) => {
                const isCompleted = currentStep > st.num || (result?.success && currentStep >= 4);
                const isCurrent = currentStep === st.num && !result;

                return (
                  <div
                    key={st.num}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      background: isCurrent ? "rgba(124, 77, 255, 0.08)" : "transparent",
                      border: isCurrent ? "1px solid rgba(124, 77, 255, 0.25)" : "1px solid transparent",
                      transition: "all 0.2s ease"
                    }}
                  >
                    <div
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "11px",
                        fontWeight: 700,
                        flexShrink: 0,
                        marginTop: "1px",
                        background: isCompleted
                          ? "#35F2D0"
                          : isCurrent
                            ? "linear-gradient(135deg, #7C4DFF, #B24BFF)"
                            : "#2A2145",
                        color: isCompleted ? "#07050F" : "#FFFFFF"
                      }}
                    >
                      {isCompleted ? "✓" : isCurrent ? "⟳" : st.num}
                    </div>

                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: "13px",
                          fontWeight: isCurrent || isCompleted ? 600 : 500,
                          color: isCompleted ? "#35F2D0" : isCurrent ? "#FFFFFF" : "#8E88A8"
                        }}
                      >
                        {st.title}
                      </div>
                      <div style={{ fontSize: "11px", color: isCurrent ? "#A59CC4" : "#6E678A" }}>
                        {st.desc}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Result Box */}
            {result && (
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: "10px",
                  background: result.success ? "rgba(53, 242, 208, 0.1)" : "rgba(255, 79, 154, 0.1)",
                  border: `1px solid ${result.success ? "#35F2D0" : "#FF4F9A"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "10px"
                }}
              >
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: result.success ? "#35F2D0" : "#FF4F9A" }}>
                    {result.success
                      ? `✅ Знайдено ${result.count} сетапи: ${result.symbols.join(", ")}`
                      : `❌ ${result.error}`}
                  </div>
                  {result.success && (
                    <div style={{ fontSize: "11px", color: "#A59CC4", marginTop: "2px" }}>
                      Сигнали додано у вашу стрічку. Оновлення списку...
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="bt sm pr"
                  style={{
                    fontSize: "12px",
                    height: "32px",
                    padding: "0 14px",
                    background: result.success ? "#35F2D0" : "#2A2145",
                    color: result.success ? "#07050F" : "#FFFFFF"
                  }}
                >
                  {result.success ? "Переглянути сигнали" : "Закрити"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
