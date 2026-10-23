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
  height = "520px",
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
      backgroundColor: "#000000",
      gridColor: "#1A1A1A",
      hide_top_toolbar: !showToolbar,
      hide_legend: false,
      hide_side_toolbar: !showToolbar,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
      studies: ["STD;RSI"],
      overrides: {
        "paneProperties.background": "#000000",
        "paneProperties.backgroundType": "solid",
        "paneProperties.vertGridProperties.color": "#1A1A1A",
        "paneProperties.horzGridProperties.color": "#1A1A1A",
        "scalesProperties.textColor": "#9A9A9A",
        "scalesProperties.lineColor": "#262626",
        "mainSeriesProperties.candleStyle.upColor": "#42F5B9",
        "mainSeriesProperties.candleStyle.downColor": "#FF5A6E",
        "mainSeriesProperties.candleStyle.drawWick": true,
        "mainSeriesProperties.candleStyle.drawBorder": true,
        "mainSeriesProperties.candleStyle.borderColor": "#262626",
        "mainSeriesProperties.candleStyle.borderUpColor": "#42F5B9",
        "mainSeriesProperties.candleStyle.borderDownColor": "#FF5A6E",
        "mainSeriesProperties.candleStyle.wickUpColor": "#42F5B9",
        "mainSeriesProperties.candleStyle.wickDownColor": "#FF5A6E"
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
        height,
        background: "#000000",
        borderRadius: "8px",
        overflow: "hidden"
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%"
        }}
      />
    </div>
  );
}
