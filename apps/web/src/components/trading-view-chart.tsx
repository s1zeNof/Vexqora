"use client";

import { useEffect, useRef, useState } from "react";

interface TradingViewChartProps {
  symbol: string;
  height?: number | string;
  interval?: "1" | "5" | "15" | "60" | "240" | "D";
  showToolbar?: boolean;
  onSwitchToTerminal?: () => void;
}

export function TradingViewChart({
  symbol,
  height = "520px",
  interval = "15",
  showToolbar = true,
  onSwitchToTerminal
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    setMounted(true);
  }, []);

  const cleanSym = symbol.replace(/[^A-Z0-9]/g, "").toUpperCase();
  const tvSymbol = cleanSym.endsWith("USDT")
    ? `BYBIT:${cleanSym}.P`
    : `BYBIT:${cleanSym}USDT.P`;

  useEffect(() => {
    if (!mounted || !containerRef.current) return;

    setStatus("loading");
    const container = containerRef.current;
    container.innerHTML = "";

    // TradingView Advanced Chart script expects this exact hierarchy:
    // Container must have class "tradingview-widget-container"
    // and contain a child with class "tradingview-widget-container__widget".
    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.width = "100%";
    widgetDiv.style.height = "100%";
    container.appendChild(widgetDiv);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;

    const widgetConfig = {
      autosize: true,
      symbol: tvSymbol,
      interval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1", // Candlesticks
      locale: "uk",
      enable_publishing: false,
      backgroundColor: "#07050F",
      gridColor: "#171229",
      hide_top_toolbar: !showToolbar,
      hide_legend: false,
      hide_side_toolbar: !showToolbar,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
      studies: ["STD;RSI"],
      overrides: {
        "paneProperties.background": "#07050F",
        "paneProperties.backgroundType": "solid",
        "paneProperties.vertGridProperties.color": "#171229",
        "paneProperties.horzGridProperties.color": "#171229",
        "scalesProperties.textColor": "#A59CC4",
        "scalesProperties.lineColor": "#2A2145",
        "mainSeriesProperties.candleStyle.upColor": "#42F5B9",
        "mainSeriesProperties.candleStyle.downColor": "#FF4F9A",
        "mainSeriesProperties.candleStyle.drawWick": true,
        "mainSeriesProperties.candleStyle.drawBorder": true,
        "mainSeriesProperties.candleStyle.borderColor": "#2A2145",
        "mainSeriesProperties.candleStyle.borderUpColor": "#42F5B9",
        "mainSeriesProperties.candleStyle.borderDownColor": "#FF4F9A",
        "mainSeriesProperties.candleStyle.wickUpColor": "#42F5B9",
        "mainSeriesProperties.candleStyle.wickDownColor": "#FF4F9A"
      }
    };

    script.innerHTML = JSON.stringify(widgetConfig);

    script.onerror = () => {
      setStatus("failed");
    };

    container.appendChild(script);

    // Watch for TradingView iframe creation or timeout
    let checkInterval: NodeJS.Timeout | null = null;
    let attempts = 0;
    checkInterval = setInterval(() => {
      attempts++;
      if (container.querySelector("iframe")) {
        setStatus("ready");
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
      } else if (attempts >= 18) {
        // 18 * 200ms = 3.6s without iframe -> timeout/blocked
        setStatus("failed");
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
      }
    }, 200);

    return () => {
      if (checkInterval) {
        clearInterval(checkInterval);
      }
      container.innerHTML = "";
    };
  }, [mounted, tvSymbol, interval, showToolbar]);

  return (
    <div
      className="tradingview-container-box"
      style={{
        position: "relative",
        width: "100%",
        height,
        background: "#07050F",
        borderRadius: "8px",
        overflow: "hidden"
      }}
    >
      <div
        className="tradingview-widget-container"
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%"
        }}
      />

      {/* Loading Overlay */}
      {status === "loading" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#07050F",
            zIndex: 2,
            color: "#A59CC4",
            fontSize: "13px"
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
            <span
              className="spin-anim"
              style={{
                width: "26px",
                height: "26px",
                border: "2.5px solid #2A2145",
                borderTopColor: "#42F5B9",
                borderRadius: "50%",
                display: "inline-block"
              }}
            />
            <span style={{ fontSize: "12px", color: "#A59CC4" }}>
              Завантаження графіка TradingView ({tvSymbol})...
            </span>
          </div>
        </div>
      )}

      {/* Blocked / Unavailable Fallback */}
      {status === "failed" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#07050FEE",
            padding: "24px",
            textAlign: "center",
            zIndex: 3
          }}
        >
          <div
            style={{
              maxWidth: "460px",
              background: "#0E0B1A",
              border: "1px solid #2A2145",
              borderRadius: "12px",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "12px"
            }}
          >
            <div style={{ fontSize: "28px" }}>📊</div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "#F1EEFF" }}>
              TradingView віджет не завантажився
            </div>
            <div style={{ fontSize: "12px", color: "#A59CC4", lineHeight: 1.5 }}>
              Скрипт віджета для контракту <b style={{ color: "#35F2D0" }}>{tvSymbol}</b> заблоковано браузером (AdBlock / Brave Shields) або пару ще не додано в базу TradingView.
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "6px", flexWrap: "wrap", justifyContent: "center" }}>
              {onSwitchToTerminal && (
                <button
                  type="button"
                  onClick={onSwitchToTerminal}
                  className="bt pr"
                  style={{
                    padding: "7px 16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer"
                  }}
                >
                  ⚡ Відкрити Термінал Vexqora
                </button>
              )}
              <a
                href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`}
                target="_blank"
                rel="noreferrer"
                className="bt"
                style={{
                  padding: "7px 14px",
                  fontSize: "12px",
                  color: "#B9A2FF",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px"
                }}
              >
                Відкрити на TradingView ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

