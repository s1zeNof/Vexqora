"use client";

import { useEffect, useRef, useState } from "react";

interface TradingViewChartProps {
  symbol: string;
  height?: number | string;
  interval?: "1" | "5" | "15" | "60" | "240" | "D";
  showToolbar?: boolean;
}

export function TradingViewChart({
  symbol,
  height = "420px",
  interval = "15",
  showToolbar = true
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !containerRef.current) return;

    // Clean up previous widget
    containerRef.current.innerHTML = "";

    // Normalize symbol for TradingView: Bybit linear perp preferred
    const cleanSym = symbol.replace(/[^A-Z0-9]/g, "").toUpperCase();
    const tvSymbol = cleanSym.endsWith("USDT")
      ? `BYBIT:${cleanSym}.P`
      : `BYBIT:${cleanSym}USDT.P`;

    const widgetContainer = document.createElement("div");
    widgetContainer.className = "tradingview-widget-container__widget";
    widgetContainer.style.height = "100%";
    widgetContainer.style.width = "100%";
    containerRef.current.appendChild(widgetContainer);

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
      backgroundColor: "#07050f",
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
        "mainSeriesProperties.candleStyle.upColor": "#35F2D0",
        "mainSeriesProperties.candleStyle.downColor": "#FF4F9A",
        "mainSeriesProperties.candleStyle.drawWick": true,
        "mainSeriesProperties.candleStyle.drawBorder": true,
        "mainSeriesProperties.candleStyle.borderColor": "#2A2145",
        "mainSeriesProperties.candleStyle.borderUpColor": "#35F2D0",
        "mainSeriesProperties.candleStyle.borderDownColor": "#FF4F9A",
        "mainSeriesProperties.candleStyle.wickUpColor": "#35F2D0",
        "mainSeriesProperties.candleStyle.wickDownColor": "#FF4F9A"
      }
    };

    script.innerHTML = JSON.stringify(widgetConfig);
    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [mounted, symbol, interval, showToolbar]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: typeof height === "number" ? `${height}px` : height,
        background: "#07050f",
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid var(--line)"
      }}
    >
      <div
        ref={containerRef}
        className="tradingview-widget-container"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
