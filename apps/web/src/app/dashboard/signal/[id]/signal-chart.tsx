"use client";

import { useEffect, useRef, useState } from "react";
import type { Kline } from "@crypto-bot/shared";
import { formatPrice, formatCryptoPrice } from "../../../../lib/format";
import { TradingViewChart } from "../../../../components/trading-view-chart";

type TimeframeOption = "1m" | "5m" | "15m" | "1H" | "4H" | "1D";

const TF_MAP: Record<TimeframeOption, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1H": "60",
  "4H": "240",
  "1D": "D"
};

export interface ClosedTradeMarkerData {
  side: "long" | "short";
  leverage: number;
  entryPrice: number;
  exitPrice: number;
  exitReason?: string | null | undefined;
  pnlUsdt: number;
  pnlPct: number;
  openedAt?: string | null | undefined;
  closedAt?: string | null | undefined;
}

interface SignalChartProps {
  symbol: string;
  initialKlines: Kline[];
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  currentPrice: number;
  livePrice?: number;
  position: {
    side: "long" | "short";
    leverage: number;
    entryPrice: number;
    pnlUsdt: number;
    pnlPct: number;
    isPaper: boolean;
    openedAt?: string | null | undefined;
  } | null;
  closedPosition?: ClosedTradeMarkerData | null;
}

export function SignalChart({
  symbol,
  initialKlines,
  entry,
  stopLoss,
  tp1,
  tp2,
  tp3,
  currentPrice: initialCurrentPrice,
  livePrice,
  position,
  closedPosition
}: SignalChartProps) {
  const [chartMode, setChartMode] = useState<"tradingview" | "terminal">("terminal");
  const [showLevels, setShowLevels] = useState(false);
  const [timeframe, setTimeframe] = useState<TimeframeOption>("15m");
  const [klines, setKlines] = useState<Kline[]>(initialKlines);
  const [isLoadingKlines, setIsLoadingKlines] = useState(false);

  // Dimensions & Expansion state (TradingView-style expand & fullscreen)
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const chartCardRef = useRef<HTMLDivElement | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(840);

  // Horizontal Time Scale (Zoom & Pan) state
  const [zoom, setZoom] = useState(1.0); // 0.35 (compressed) to 3.5 (expanded wide candles)
  const [panOffset, setPanOffset] = useState(0); // number of candles shifted into the past

  // Vertical Price Scale (Stretch & Pan) state
  const [verticalStretch, setVerticalStretch] = useState(1.0); // 0.25 (compressed) to 6.0 (stretched tall candles)
  const [priceOffset, setPriceOffset] = useState(0); // vertical shift in dollars

  // Interactive Drag & Cursor state
  const [isDragging, setIsDragging] = useState(false);
  const [cursorType, setCursorType] = useState<string>("crosshair");
  const dragStartRef = useRef<{
    mode: "pan" | "scale-price" | "scale-time";
    clientX: number;
    clientY: number;
    initialStretch: number;
    initialPriceOffset: number;
    initialZoom: number;
    initialOffset: number;
  } | null>(null);

  // Multi-touch gesture state (Pinch-to-zoom & single finger pan on mobile)
  const touchStateRef = useRef<{
    mode: "none" | "pan" | "pinch" | "scale-price";
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    initialDistance: number;
    initialZoom: number;
    initialOffset: number;
    initialStretch: number;
    initialPriceOffset: number;
    lastTapTime: number;
  }>({
    mode: "none",
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    initialDistance: 0,
    initialZoom: 1,
    initialOffset: 0,
    initialStretch: 1,
    initialPriceOffset: 0,
    lastTapTime: 0
  });

  // Hover crosshair state
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);

  const activeCurrentPrice = livePrice && livePrice > 0 ? livePrice : initialCurrentPrice;

  // Responsive Container Width Observer
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const w = el.clientWidth;
      if (w > 0) {
        setContainerWidth(w);
      }
    };

    updateWidth();

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        if (cr.width > 0) {
          setContainerWidth(Math.round(cr.width));
        }
      }
    });

    ro.observe(el);
    window.addEventListener("resize", updateWidth);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateWidth);
    };
  }, []);

  // Fullscreen support
  const toggleFullscreen = () => {
    if (!chartCardRef.current) return;
    if (!document.fullscreenElement) {
      void chartCardRef.current.requestFullscreen().catch(() => {});
    } else {
      void document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  // Fetch real klines when user clicks a timeframe
  const handleTimeframeChange = async (tf: TimeframeOption) => {
    if (tf === timeframe && klines.length > 0) return;
    setTimeframe(tf);
    setIsLoadingKlines(true);
    setPanOffset(0);

    try {
      const interval = TF_MAP[tf];
      const res = await fetch(`/api/market/klines?symbol=${symbol}&interval=${interval}&limit=70`, {
        cache: "no-store"
      });
      if (res.ok) {
        const json = await res.json() as { success: boolean; klines: Kline[] };
        if (json.success && Array.isArray(json.klines) && json.klines.length > 0) {
          setKlines(json.klines);
        }
      }
    } catch {
      // Keep existing klines on network error
    } finally {
      setIsLoadingKlines(false);
    }
  };

  // Update current live candle with live price
  useEffect(() => {
    if (!activeCurrentPrice || klines.length === 0) return;
    setKlines((prev) => {
      if (prev.length === 0) return prev;
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.open > 0) {
        const driftFromOpen = Math.abs(activeCurrentPrice - last.open) / last.open;
        // Reject stray spikes (> 6% single tick from candle open) from polluting chart candle
        if (driftFromOpen > 0.06) {
          return prev;
        }
        copy[copy.length - 1] = {
          ...last,
          close: activeCurrentPrice,
          high: Math.max(last.high, activeCurrentPrice),
          low: Math.min(last.low, activeCurrentPrice)
        };
      }
      return copy;
    });
  }, [activeCurrentPrice]);

  // Fallback synthetic candles if API returned empty
  const rawKlines: Kline[] = klines.length >= 5 ? klines : (() => {
    const list: Kline[] = [];
    const base = entry || 100;
    const now = Date.now();
    for (let i = 40; i >= 0; i--) {
      const t = now - i * 15 * 60 * 1000;
      const variation = Math.sin(i * 0.4) * (base * 0.015);
      const open = base + variation;
      const close = open + Math.cos(i * 0.3) * (base * 0.01);
      const high = Math.max(open, close) + base * 0.005;
      const low = Math.min(open, close) - base * 0.005;
      list.push({ time: t, open, high, low, close, volume: 1000 + i * 50 });
    }
    return list;
  })();

  const isMobile = containerWidth < 640;

  // Responsive Height: 390px on phones, 500px on desktop (or 540px / 720px expanded)
  const defaultHeight = isMobile ? 390 : 500;
  const expandedHeight = isMobile ? 540 : 720;
  const height = isFullscreen ? (typeof window !== "undefined" ? window.innerHeight : 760) : isExpanded ? expandedHeight : defaultHeight;

  // Dynamic Price Axis Width: 54px on mobile, 76px on desktop
  const priceAxisWidth = isMobile ? 54 : 76;
  const chartRight = Math.max(120, containerWidth - priceAxisWidth);
  const chartBottom = height - 26;
  const chartTop = 20;

  // Zoom and Pan slicing (Horizontal Time Expansion)
  const baseVisibleCount = isMobile ? 26 : 38;
  const visibleCount = Math.min(
    rawKlines.length,
    Math.max(8, Math.round(baseVisibleCount / Math.max(0.3, zoom)))
  );

  const maxPanOffset = Math.max(0, rawKlines.length - visibleCount);
  const clampedPanOffset = Math.min(maxPanOffset, Math.max(0, panOffset));

  const endIndex = rawKlines.length - clampedPanOffset;
  const startIndex = Math.max(0, endIndex - visibleCount);
  const visibleKlines = rawKlines.slice(startIndex, endIndex);

  // Candle-centered vertical range calculation (Eliminates the empty black void)
  const candleHighs = visibleKlines.map((k) => k.high);
  const candleLows = visibleKlines.map((k) => k.low);
  if (activeCurrentPrice > 0) {
    candleHighs.push(activeCurrentPrice);
    candleLows.push(activeCurrentPrice);
  }

  let klineMin = Math.min(...candleLows);
  let klineMax = Math.max(...candleHighs);

  if (!Number.isFinite(klineMin) || !Number.isFinite(klineMax) || klineMin >= klineMax) {
    klineMin = (entry || 100) * 0.99;
    klineMax = (entry || 100) * 1.01;
  }

  const candleSpan = Math.max(0.0000001, klineMax - klineMin);

  let rangeMin = klineMin;
  let rangeMax = klineMax;

  // If active position exists and entry is nearby, encompass it
  if (position && position.entryPrice > 0) {
    if (Math.abs(position.entryPrice - klineMin) < candleSpan * 1.4 && Math.abs(position.entryPrice - klineMax) < candleSpan * 1.4) {
      rangeMin = Math.min(rangeMin, position.entryPrice);
      rangeMax = Math.max(rangeMax, position.entryPrice);
    }
  }

  // If levels are toggled on, only encompass nearby levels (within 0.75x of candle span)
  // so distant TP3 doesn't squash candles into a 15% strip
  if (showLevels) {
    const nearby = [entry, stopLoss, tp1, tp2, tp3].filter(
      (p) => typeof p === "number" && p > 0 && p >= klineMin - candleSpan * 0.75 && p <= klineMax + candleSpan * 0.75
    );
    if (nearby.length > 0) {
      rangeMin = Math.min(rangeMin, ...nearby);
      rangeMax = Math.max(rangeMax, ...nearby);
    }
  }

  // Include recent closed trade entry/exit if nearby
  if (closedPosition) {
    const closedPrices = [closedPosition.entryPrice, closedPosition.exitPrice].filter(
      (p) => typeof p === "number" && p > 0 && p >= klineMin - candleSpan * 0.75 && p <= klineMax + candleSpan * 0.75
    );
    if (closedPrices.length > 0) {
      rangeMin = Math.min(rangeMin, ...closedPrices);
      rangeMax = Math.max(rangeMax, ...closedPrices);
    }
  }

  const finalSpan = Math.max(0.0000001, rangeMax - rangeMin);
  const rawCenter = (rangeMax + rangeMin) / 2;
  const baseHalfRange = (finalSpan * 1.18) / 2;

  // Scaled half-range based on verticalStretch:
  // verticalStretch > 1 -> candles stretched taller (more vertical detail)
  // verticalStretch < 1 -> candles compressed flatter
  const effectiveHalfRange = baseHalfRange / Math.max(0.2, verticalStretch);
  const centerPrice = rawCenter + priceOffset;
  const minPrice = centerPrice - effectiveHalfRange;
  const maxPrice = centerPrice + effectiveHalfRange;
  const priceRange = Math.max(0.0000001, maxPrice - minPrice);

  const getY = (price: number) => {
    const ratio = (price - minPrice) / priceRange;
    return chartBottom - ratio * (chartBottom - chartTop);
  };

  const getPriceFromY = (y: number) => {
    const ratio = (chartBottom - y) / (chartBottom - chartTop);
    return minPrice + ratio * priceRange;
  };

  const candleCount = visibleKlines.length;
  const candleSlot = chartRight / Math.max(1, candleCount);
  const candleWidth = Math.max(2.5, Math.min(32, candleSlot * 0.72));

  const isPriceScaleCustom = verticalStretch !== 1.0 || priceOffset !== 0;
  const isTimeScaleCustom = zoom !== 1.0 || panOffset !== 0;
  const isAnyScaleCustom = isPriceScaleCustom || isTimeScaleCustom;

  // Mouse wheel zoom with non-passive listener (supports horizontal time zoom & vertical price stretch)
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = el.getBoundingClientRect();
      const relativeX = (e.clientX - rect.left) * (containerWidth / rect.width);
      const isOverPriceAxis = relativeX >= chartRight;

      if (isOverPriceAxis || e.altKey || e.shiftKey) {
        // Vertical price scale stretch / compress
        if (e.deltaY < 0) {
          setVerticalStretch((s) => Math.min(6.0, Number((s * 1.15).toFixed(3))));
        } else {
          setVerticalStretch((s) => Math.max(0.25, Number((s * 0.87).toFixed(3))));
        }
      } else {
        // Horizontal time scale zoom
        if (e.deltaY < 0) {
          setZoom((z) => Math.min(3.5, Number((z + 0.15).toFixed(2))));
        } else {
          setZoom((z) => Math.max(0.35, Number((z - 0.15).toFixed(2))));
        }
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [containerWidth, chartRight]);

  // Touch gesture handling (Pinch-to-zoom & single-finger pan for mobile phones)
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Pinch-to-zoom start
        e.preventDefault();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        if (!t0 || !t1) return;
        const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        touchStateRef.current = {
          ...touchStateRef.current,
          mode: "pinch",
          initialDistance: dist,
          initialZoom: zoom,
          initialStretch: verticalStretch
        };
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        if (!t) return;
        const rect = el.getBoundingClientRect();
        const relX = (t.clientX - rect.left) * (containerWidth / rect.width);
        const relY = (t.clientY - rect.top) * (height / rect.height);

        // Detect double-tap to reset scale (Auto)
        const now = Date.now();
        if (now - touchStateRef.current.lastTapTime < 320) {
          handleResetAllScales();
          touchStateRef.current.lastTapTime = 0;
          return;
        }
        touchStateRef.current.lastTapTime = now;

        const isOverPriceAxis = relX >= chartRight;
        touchStateRef.current = {
          ...touchStateRef.current,
          mode: isOverPriceAxis ? "scale-price" : "pan",
          startX: t.clientX,
          startY: t.clientY,
          lastX: t.clientX,
          lastY: t.clientY,
          initialZoom: zoom,
          initialOffset: clampedPanOffset,
          initialStretch: verticalStretch,
          initialPriceOffset: priceOffset
        };

        // Tap updates crosshair
        if (!isOverPriceAxis && relY >= chartTop && relY <= chartBottom) {
          const idx = Math.floor(relX / candleSlot);
          setHoverIndex(Math.min(visibleKlines.length - 1, Math.max(0, idx)));
          setHoverY(relY);
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (touchStateRef.current.mode === "none") return;
      e.preventDefault(); // Prevent page scrolling while interacting with chart

      if (e.touches.length === 2 && touchStateRef.current.mode === "pinch") {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        if (!t0 || !t1) return;
        const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        if (touchStateRef.current.initialDistance > 0) {
          const scale = dist / touchStateRef.current.initialDistance;
          const newZoom = Math.max(0.35, Math.min(3.5, Number((touchStateRef.current.initialZoom * scale).toFixed(2))));
          setZoom(newZoom);
        }
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        if (!t) return;
        const rect = el.getBoundingClientRect();
        const relX = (t.clientX - rect.left) * (containerWidth / rect.width);
        const relY = (t.clientY - rect.top) * (height / rect.height);

        if (touchStateRef.current.mode === "scale-price") {
          const dy = touchStateRef.current.startY - t.clientY;
          const factor = 1 + dy * 0.007;
          const newStretch = Math.max(0.25, Math.min(6.0, Number((touchStateRef.current.initialStretch * factor).toFixed(3))));
          setVerticalStretch(newStretch);
        } else if (touchStateRef.current.mode === "pan") {
          const dx = t.clientX - touchStateRef.current.startX;
          const candleShift = Math.round(dx / Math.max(1, candleSlot));
          const newOffset = touchStateRef.current.initialOffset + candleShift;
          setPanOffset(Math.min(maxPanOffset, Math.max(0, newOffset)));

          const dy = t.clientY - touchStateRef.current.startY;
          const priceDelta = (dy / (chartBottom - chartTop)) * priceRange;
          setPriceOffset(touchStateRef.current.initialPriceOffset + priceDelta);

          // Update crosshair on drag
          if (relX >= 0 && relX <= chartRight && relY >= chartTop && relY <= chartBottom) {
            const idx = Math.floor(relX / candleSlot);
            setHoverIndex(Math.min(visibleKlines.length - 1, Math.max(0, idx)));
            setHoverY(relY);
          }
        }
      }
    };

    const onTouchEnd = () => {
      touchStateRef.current.mode = "none";
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [containerWidth, height, chartRight, chartTop, chartBottom, candleSlot, visibleKlines.length, zoom, verticalStretch, clampedPanOffset, priceOffset, maxPanOffset, priceRange]);

  // Pointer & Drag handling for desktop mouse
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch") return; // Touch events are handled separately for multi-touch gestures
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = containerWidth / rect.width;
    const scaleY = height / rect.height;
    const svgX = (e.clientX - rect.left) * scaleX;
    const svgY = (e.clientY - rect.top) * scaleY;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore unsupported pointer capture environments
    }

    if (svgX >= chartRight && svgY <= chartBottom) {
      // Dragging vertical price scale (TradingView style stretch)
      dragStartRef.current = {
        mode: "scale-price",
        clientX: e.clientX,
        clientY: e.clientY,
        initialStretch: verticalStretch,
        initialPriceOffset: priceOffset,
        initialZoom: zoom,
        initialOffset: clampedPanOffset
      };
      setIsDragging(true);
      setCursorType("ns-resize");
    } else if (svgY >= chartBottom && svgX <= chartRight) {
      // Dragging horizontal time scale (TradingView style time stretch)
      dragStartRef.current = {
        mode: "scale-time",
        clientX: e.clientX,
        clientY: e.clientY,
        initialStretch: verticalStretch,
        initialPriceOffset: priceOffset,
        initialZoom: zoom,
        initialOffset: clampedPanOffset
      };
      setIsDragging(true);
      setCursorType("ew-resize");
    } else if (svgX >= chartRight && svgY > chartBottom) {
      // Clicked Auto button in corner
      handleResetPriceScale();
    } else {
      // Dragging chart canvas (Pan 2D)
      dragStartRef.current = {
        mode: "pan",
        clientX: e.clientX,
        clientY: e.clientY,
        initialStretch: verticalStretch,
        initialPriceOffset: priceOffset,
        initialZoom: zoom,
        initialOffset: clampedPanOffset
      };
      setIsDragging(true);
      setCursorType("grabbing");
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = containerWidth / rect.width;
    const scaleY = height / rect.height;
    const svgX = (e.clientX - rect.left) * scaleX;
    const svgY = (e.clientY - rect.top) * scaleY;

    if (!isDragging) {
      // Hover cursor & zones
      if (svgX >= chartRight && svgY <= chartBottom) {
        setCursorType("ns-resize");
      } else if (svgY >= chartBottom && svgX <= chartRight) {
        setCursorType("ew-resize");
      } else if (svgX >= chartRight && svgY > chartBottom) {
        setCursorType("pointer");
      } else {
        setCursorType("crosshair");
      }

      // Crosshair coordinates
      if (svgX >= 0 && svgX <= chartRight && svgY >= chartTop && svgY <= chartBottom) {
        const idx = Math.floor(svgX / candleSlot);
        setHoverIndex(Math.min(visibleKlines.length - 1, Math.max(0, idx)));
        setHoverY(svgY);
      } else {
        setHoverIndex(null);
        setHoverY(null);
      }
      return;
    }

    // Active drag handling
    if (dragStartRef.current) {
      const mode = dragStartRef.current.mode;
      if (mode === "scale-price") {
        // Dragging up (negative dy) expands price scale vertically
        const dy = dragStartRef.current.clientY - e.clientY;
        const factor = 1 + dy * 0.007;
        const newStretch = Math.max(0.25, Math.min(6.0, Number((dragStartRef.current.initialStretch * factor).toFixed(3))));
        setVerticalStretch(newStretch);
      } else if (mode === "scale-time") {
        // Dragging right (positive dx) expands time scale horizontally
        const dx = e.clientX - dragStartRef.current.clientX;
        const factor = 1 + dx * 0.005;
        const newZoom = Math.max(0.35, Math.min(3.5, Number((dragStartRef.current.initialZoom * factor).toFixed(3))));
        setZoom(newZoom);
      } else if (mode === "pan") {
        // Pan time horizontally
        const dx = e.clientX - dragStartRef.current.clientX;
        const candleShift = Math.round(dx / candleSlot);
        const newOffset = dragStartRef.current.initialOffset + candleShift;
        setPanOffset(Math.min(maxPanOffset, Math.max(0, newOffset)));

        // Pan price vertically
        const dy = e.clientY - dragStartRef.current.clientY;
        const priceDelta = (dy / (chartBottom - chartTop)) * priceRange;
        setPriceOffset(dragStartRef.current.initialPriceOffset + priceDelta);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch") return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore unsupported pointer capture environments
    }
    setIsDragging(false);
    dragStartRef.current = null;
  };

  // Double-click resets scale (TradingView standard behavior)
  const handleDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = containerWidth / rect.width;
    const scaleY = height / rect.height;
    const svgX = (e.clientX - rect.left) * scaleX;
    const svgY = (e.clientY - rect.top) * scaleY;

    if (svgX >= chartRight) {
      handleResetPriceScale();
    } else if (svgY >= chartBottom) {
      handleResetTimeScale();
    } else {
      handleResetAllScales();
    }
  };

  const handleResetPriceScale = () => {
    setVerticalStretch(1.0);
    setPriceOffset(0);
  };

  const handleResetTimeScale = () => {
    setZoom(1.0);
    setPanOffset(0);
  };

  const handleResetAllScales = () => {
    setVerticalStretch(1.0);
    setPriceOffset(0);
    setZoom(1.0);
    setPanOffset(0);
  };

  // Hovered candle data for OHLC header
  const hoveredCandle = hoverIndex !== null ? visibleKlines[hoverIndex] : visibleKlines[visibleKlines.length - 1];
  const candleChangePct = hoveredCandle && hoveredCandle.open > 0
    ? ((hoveredCandle.close - hoveredCandle.open) / hoveredCandle.open) * 100
    : 0;

  // Find visible lowest and highest candles for Bybit-style viewport price markers
  let lowestCandleIdx = -1;
  let highestCandleIdx = -1;
  let lowestPrice = Infinity;
  let highestPrice = -Infinity;

  visibleKlines.forEach((candle, idx) => {
    if (candle.low < lowestPrice) {
      lowestPrice = candle.low;
      lowestCandleIdx = idx;
    }
    if (candle.high > highestPrice) {
      highestPrice = candle.high;
      highestCandleIdx = idx;
    }
  });

  const lowestCandle = lowestCandleIdx >= 0 ? visibleKlines[lowestCandleIdx] : null;
  const highestCandle = highestCandleIdx >= 0 ? visibleKlines[highestCandleIdx] : null;

  return (
    <div ref={chartCardRef} className="cd" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Top Chart Header: Controls & Target Levels Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
          padding: "8px 12px",
          borderBottom: "1px solid #262626",
          background: "#111111"
        }}
      >
        {/* View Mode Switcher */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            type="button"
            onClick={() => setChartMode("terminal")}
            className={`tab ${chartMode === "terminal" ? "on" : ""}`}
            style={{ padding: "4px 10px", fontSize: "11px", fontWeight: 600 }}
          >
            Термінал Vexqora
          </button>
          <button
            type="button"
            onClick={() => setChartMode("tradingview")}
            className={`tab ${chartMode === "tradingview" ? "on" : ""}`}
            style={{ padding: "4px 10px", fontSize: "11px", fontWeight: 600 }}
          >
            TradingView
          </button>
        </div>

        {/* Level Badges in Header: Horizontally Scrollable Strip (no-scrollbar) */}
        <div
          className="no-scrollbar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            overflowX: "auto",
            WebkitOverflowScrolling: "touch",
            whiteSpace: "nowrap",
            maxWidth: isMobile ? "100%" : "auto",
            padding: "2px 0"
          }}
        >
          {entry > 0 && (
            <span
              style={{
                fontSize: "11px",
                fontVariantNumeric: "tabular-nums",
                background: "#1A1528",
                border: "1px solid #2A2145",
                borderRadius: "4px",
                padding: "2px 6px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px"
              }}
            >
              <span style={{ color: "#A59CC4" }}>Вхід:</span> <b style={{ color: "#FFFFFF" }}>{formatCryptoPrice(entry)}</b>
            </span>
          )}
          {stopLoss > 0 && (
            <span
              style={{
                fontSize: "11px",
                fontVariantNumeric: "tabular-nums",
                background: "#221118",
                border: "1px solid #FF5A6E44",
                borderRadius: "4px",
                padding: "2px 6px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px"
              }}
            >
              <span style={{ color: "#FF5A6E" }}>SL:</span> <b style={{ color: "#FF5A6E" }}>{formatCryptoPrice(stopLoss)}</b>
            </span>
          )}
          {tp1 > 0 && (
            <span
              style={{
                fontSize: "11px",
                fontVariantNumeric: "tabular-nums",
                background: "#0E1F1A",
                border: "1px solid #42F5B944",
                borderRadius: "4px",
                padding: "2px 6px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px"
              }}
            >
              <span style={{ color: "#42F5B9" }}>TP1:</span> <b style={{ color: "#42F5B9" }}>{formatCryptoPrice(tp1)}</b>
            </span>
          )}
          {tp2 > 0 && (
            <span
              style={{
                fontSize: "11px",
                fontVariantNumeric: "tabular-nums",
                background: "#0E1F1A",
                border: "1px solid #42F5B944",
                borderRadius: "4px",
                padding: "2px 6px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px"
              }}
            >
              <span style={{ color: "#42F5B9" }}>TP2:</span> <b style={{ color: "#42F5B9" }}>{formatCryptoPrice(tp2)}</b>
            </span>
          )}
          {tp3 > 0 && (
            <span
              style={{
                fontSize: "11px",
                fontVariantNumeric: "tabular-nums",
                background: "#0E1F1A",
                border: "1px solid #42F5B944",
                borderRadius: "4px",
                padding: "2px 6px",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px"
              }}
            >
              <span style={{ color: "#42F5B9" }}>TP3:</span> <b style={{ color: "#42F5B9" }}>{formatCryptoPrice(tp3)}</b>
            </span>
          )}
        </div>
      </div>

      {/* Main Chart Body */}
      {chartMode === "tradingview" ? (
        <div style={{ position: "relative", width: "100%", height: isExpanded ? "740px" : isMobile ? "420px" : "540px", background: "#07050F", transition: "height 0.25s ease" }}>
          <TradingViewChart
            symbol={symbol}
            height={isExpanded ? "740px" : isMobile ? "420px" : "540px"}
            interval="15"
            showToolbar={true}
            onSwitchToTerminal={() => setChartMode("terminal")}
          />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", background: "#050505" }}>
          {/* Sub-Bar Toolbar: Timeframes & Scale Tools in Horizontal Scroll Strip */}
          <div
            className="no-scrollbar"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "6px",
              padding: "7px 10px",
              background: "#0A0815",
              borderBottom: "1px solid #1D172E",
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              whiteSpace: "nowrap"
            }}
          >
            {/* Timeframe Buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
              {(["1m", "5m", "15m", "1H", "4H", "1D"] as const).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => {
                    void handleTimeframeChange(tf);
                  }}
                  disabled={isLoadingKlines}
                  className={`tab ${timeframe === tf ? "on" : ""}`}
                  style={{
                    padding: "3px 8px",
                    fontSize: "11px",
                    fontWeight: 600,
                    opacity: isLoadingKlines && timeframe === tf ? 0.6 : 1
                  }}
                >
                  {tf}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "5px", flexShrink: 0 }}>
              {/* Horizontal Width Expansion Controls (↔) */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  background: "#141022",
                  borderRadius: "4px",
                  border: "1px solid #2A2145",
                  padding: "1px"
                }}
                title="Ширина свічок (↔)"
              >
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(3.5, Number((z + 0.2).toFixed(2))))}
                  className="bt sm"
                  style={{ padding: "2px 6px", fontSize: "11px", height: "22px", minWidth: "22px", border: "none" }}
                  title="Розширити свічки по ширині (↔+)"
                >
                  ↔+
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.35, Number((z - 0.2).toFixed(2))))}
                  className="bt sm"
                  style={{ padding: "2px 6px", fontSize: "11px", height: "22px", minWidth: "22px", border: "none" }}
                  title="Звузити свічки по ширині (↔−)"
                >
                  ↔−
                </button>
              </div>

              {/* Vertical Height Expansion Controls (↕) */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  background: "#141022",
                  borderRadius: "4px",
                  border: "1px solid #2A2145",
                  padding: "1px"
                }}
                title="Висота свічок (↕)"
              >
                <button
                  type="button"
                  onClick={() => setVerticalStretch((s) => Math.min(6.0, Number((s * 1.25).toFixed(3))))}
                  className="bt sm"
                  style={{ padding: "2px 6px", fontSize: "11px", height: "22px", minWidth: "22px", border: "none" }}
                  title="Розтягнути свічки по висоті (↕+)"
                >
                  ↕+
                </button>
                <button
                  type="button"
                  onClick={() => setVerticalStretch((s) => Math.max(0.25, Number((s * 0.80).toFixed(3))))}
                  className="bt sm"
                  style={{ padding: "2px 6px", fontSize: "11px", height: "22px", minWidth: "22px", border: "none" }}
                  title="Стиснути свічки по висоті (↕−)"
                >
                  ↕−
                </button>
              </div>

              {/* Toggle Levels Button */}
              <button
                type="button"
                onClick={() => setShowLevels((v) => !v)}
                className={`bt sm ${showLevels ? "pr" : ""}`}
                title="Показати або приховати рівні TP/SL на графіку"
                style={{
                  padding: "2px 7px",
                  fontSize: "11px",
                  height: "24px",
                  color: showLevels ? "#42F5B9" : "#A0A0A0"
                }}
              >
                {showLevels ? "🎯 Рівні" : "🎯 Рівні"}
              </button>

              {/* Reset to Auto Button */}
              {isAnyScaleCustom && (
                <button
                  type="button"
                  onClick={handleResetAllScales}
                  className="bt sm"
                  title="Скинути всі масштаби до Auto (1:1)"
                  style={{
                    padding: "2px 8px",
                    fontSize: "11px",
                    height: "24px",
                    color: "#35F2D0",
                    borderColor: "rgba(53, 242, 208, 0.4)",
                    background: "rgba(53, 242, 208, 0.12)",
                    fontWeight: 600
                  }}
                >
                  ↺ Auto
                </button>
              )}

              {/* Expand / Minimize Container Height Toggle */}
              <button
                type="button"
                onClick={() => setIsExpanded((v) => !v)}
                className={`bt sm ${isExpanded ? "pr" : ""}`}
                title={isExpanded ? "Зменшити висоту графіка" : "Розгорнути висоту графіка"}
                style={{
                  padding: "2px 7px",
                  fontSize: "11px",
                  height: "24px",
                  color: isExpanded ? "#35F2D0" : "#B5A9D6",
                  borderColor: isExpanded ? "rgba(53, 242, 208, 0.4)" : "#2A2145"
                }}
              >
                <span>{isExpanded ? "⤡" : "⤢"}</span>
              </button>

              {/* Fullscreen Toggle */}
              <button
                type="button"
                onClick={toggleFullscreen}
                className="bt sm"
                title={isFullscreen ? "Вийти з повноекранного режиму" : "Повноекранний режим терміналу"}
                style={{
                  padding: "2px 7px",
                  fontSize: "12px",
                  height: "24px",
                  color: isFullscreen ? "#35F2D0" : "#A59CC4"
                }}
              >
                {isFullscreen ? "🗗" : "⛶"}
              </button>

              {isLoadingKlines && (
                <span style={{ fontSize: "11px", color: "#42F5B9", marginLeft: "2px" }}>
                  ●
                </span>
              )}
            </div>
          </div>

          {/* Dedicated OHLCV Info Bar (Outside SVG: Never overlaps candles or wicks!) */}
          {hoveredCandle && (
            <div
              className="no-scrollbar"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "3px 10px",
                background: "#080612",
                borderBottom: "1px solid #1A142E",
                fontSize: "11px",
                fontFamily: "'JetBrains Mono', monospace",
                fontVariantNumeric: "tabular-nums",
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
                whiteSpace: "nowrap",
                gap: "8px"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span>O <b style={{ color: "#E0E0E0" }}>{formatCryptoPrice(hoveredCandle.open)}</b></span>
                <span>H <b style={{ color: "#42F5B9" }}>{formatCryptoPrice(hoveredCandle.high)}</b></span>
                <span>L <b style={{ color: "#FF5A6E" }}>{formatCryptoPrice(hoveredCandle.low)}</b></span>
                <span>C <b style={{ color: hoveredCandle.close >= hoveredCandle.open ? "#42F5B9" : "#FF5A6E" }}>{formatCryptoPrice(hoveredCandle.close)}</b></span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ color: candleChangePct >= 0 ? "#42F5B9" : "#FF5A6E", fontWeight: 600 }}>
                  {candleChangePct >= 0 ? "+" : ""}{candleChangePct.toFixed(2)}%
                </span>
                {hoveredCandle.volume ? (
                  <span style={{ color: "#7D749C" }}>
                    Vol <b style={{ color: "#A0A0A0" }}>{hoveredCandle.volume >= 1000000 ? `${(hoveredCandle.volume / 1000000).toFixed(2)}M` : hoveredCandle.volume >= 1000 ? `${(hoveredCandle.volume / 1000).toFixed(1)}k` : Math.round(hoveredCandle.volume)}</b>
                  </span>
                ) : null}
              </div>
            </div>
          )}

          {/* SVG Candlestick & Levels Canvas */}
          <div
            ref={chartContainerRef}
            style={{
              position: "relative",
              width: "100%",
              height: `${height}px`,
              background: "#050505",
              userSelect: "none",
              overflow: "hidden",
              touchAction: "none",
              transition: "height 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
            }}
          >
            <svg
              width={containerWidth}
              height={height}
              viewBox={`0 0 ${containerWidth} ${height}`}
              role="img"
              aria-label={`${symbol} interactive chart with Entry, SL, TP levels and TradingView scaling`}
              className="chart-svg"
              style={{
                width: "100%",
                height: `${height}px`,
                display: "block",
                cursor: isDragging
                  ? dragStartRef.current?.mode === "scale-price"
                    ? "ns-resize"
                    : dragStartRef.current?.mode === "scale-time"
                      ? "ew-resize"
                      : "grabbing"
                  : cursorType,
                touchAction: "none"
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onDoubleClick={handleDoubleClick}
              onMouseLeave={() => {
                if (!isDragging) {
                  setHoverIndex(null);
                  setHoverY(null);
                }
              }}
            >
              {/* Axis Area Backgrounds for visual separation (TradingView style) */}
              <rect
                x={chartRight}
                y={0}
                width={priceAxisWidth}
                height={chartBottom}
                fill="#080612"
                stroke="#1D172E"
                strokeWidth="0.8"
                opacity="0.85"
              />
              <rect
                x={0}
                y={chartBottom}
                width={chartRight}
                height={height - chartBottom}
                fill="#080612"
                stroke="#1D172E"
                strokeWidth="0.8"
                opacity="0.85"
              />

              {/* Horizontal Grid lines */}
              {[0.14, 0.32, 0.50, 0.68, 0.86].map((ratio) => {
                const y = chartBottom - ratio * (chartBottom - chartTop);
                const priceAtGrid = minPrice + ratio * priceRange;
                return (
                  <g key={ratio}>
                    <line
                      x1={0}
                      x2={chartRight}
                      y1={y}
                      y2={y}
                      stroke="#161324"
                      strokeWidth="1"
                    />
                    <text
                      x={chartRight + 4}
                      y={y + 3}
                      fill="#6C628A"
                      fontSize={isMobile ? "9" : "10"}
                      fontFamily="'JetBrains Mono', monospace"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {formatPrice(priceAtGrid)}
                    </text>
                  </g>
                );
              })}

              {/* Target Level Lines (Toggleable via showLevels button) */}
              {showLevels && stopLoss > 0 && stopLoss >= minPrice && stopLoss <= maxPrice && (
                <g>
                  <line
                    x1={0}
                    x2={chartRight}
                    y1={getY(stopLoss)}
                    y2={getY(stopLoss)}
                    stroke="#FF5A6E"
                    strokeWidth="1.2"
                    strokeDasharray="4 4"
                  />
                  <rect
                    x={chartRight + 2}
                    y={getY(stopLoss) - 8}
                    width={priceAxisWidth - 4}
                    height={16}
                    fill="#FF5A6E22"
                    stroke="#FF5A6E"
                    strokeWidth="0.8"
                    rx="3"
                  />
                  <text
                    x={chartRight + (priceAxisWidth - 4) / 2}
                    y={getY(stopLoss) + 3}
                    fill="#FF5A6E"
                    fontSize={isMobile ? "8.5" : "9.5"}
                    fontWeight="600"
                    textAnchor="middle"
                    fontFamily="'JetBrains Mono', monospace"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    SL {formatPrice(stopLoss)}
                  </text>
                </g>
              )}

              {/* Entry Price Line (White) */}
              {showLevels && entry > 0 && entry >= minPrice && entry <= maxPrice && (
                <g>
                  <line
                    x1={0}
                    x2={chartRight}
                    y1={getY(entry)}
                    y2={getY(entry)}
                    stroke="#FFFFFF"
                    strokeWidth="1.2"
                    strokeDasharray="4 4"
                  />
                  <rect
                    x={chartRight + 2}
                    y={getY(entry) - 8}
                    width={priceAxisWidth - 4}
                    height={16}
                    fill="#2A2A2A"
                    stroke="#555555"
                    strokeWidth="0.8"
                    rx="3"
                  />
                  <text
                    x={chartRight + (priceAxisWidth - 4) / 2}
                    y={getY(entry) + 3}
                    fill="#FFFFFF"
                    fontSize={isMobile ? "8.5" : "9.5"}
                    fontWeight="600"
                    textAnchor="middle"
                    fontFamily="'JetBrains Mono', monospace"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    Вхід {formatPrice(entry)}
                  </text>
                </g>
              )}

              {/* Take Profit 1 Line (Green) */}
              {showLevels && tp1 > 0 && tp1 >= minPrice && tp1 <= maxPrice && (
                <g>
                  <line
                    x1={0}
                    x2={chartRight}
                    y1={getY(tp1)}
                    y2={getY(tp1)}
                    stroke="#42F5B9"
                    strokeWidth="1.2"
                    strokeDasharray="4 4"
                  />
                  <rect
                    x={chartRight + 2}
                    y={getY(tp1) - 8}
                    width={priceAxisWidth - 4}
                    height={16}
                    fill="#42F5B922"
                    stroke="#42F5B9"
                    strokeWidth="0.8"
                    rx="3"
                  />
                  <text
                    x={chartRight + (priceAxisWidth - 4) / 2}
                    y={getY(tp1) + 3}
                    fill="#42F5B9"
                    fontSize={isMobile ? "8.5" : "9.5"}
                    fontWeight="600"
                    textAnchor="middle"
                    fontFamily="'JetBrains Mono', monospace"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    TP1 {formatPrice(tp1)}
                  </text>
                </g>
              )}

              {/* Take Profit 2 Line */}
              {showLevels && tp2 > 0 && tp2 >= minPrice && tp2 <= maxPrice && (
                <g>
                  <line
                    x1={0}
                    x2={chartRight}
                    y1={getY(tp2)}
                    y2={getY(tp2)}
                    stroke="#42F5B9"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={chartRight + 4}
                    y={getY(tp2) + 3}
                    fill="#42F5B9"
                    fontSize={isMobile ? "8.5" : "9.5"}
                    fontFamily="'JetBrains Mono', monospace"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    TP2 {formatPrice(tp2)}
                  </text>
                </g>
              )}

              {/* Take Profit 3 Line */}
              {showLevels && tp3 > 0 && tp3 >= minPrice && tp3 <= maxPrice && (
                <g>
                  <line
                    x1={0}
                    x2={chartRight}
                    y1={getY(tp3)}
                    y2={getY(tp3)}
                    stroke="#42F5B9"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={chartRight + 4}
                    y={getY(tp3) + 3}
                    fill="#42F5B9"
                    fontSize={isMobile ? "8.5" : "9.5"}
                    fontFamily="'JetBrains Mono', monospace"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    TP3 {formatPrice(tp3)}
                  </text>
                </g>
              )}

              {/* Live Current Price Line with solid bright label */}
              {activeCurrentPrice > 0 && activeCurrentPrice >= minPrice && activeCurrentPrice <= maxPrice && (
                <g>
                  <line
                    x1={0}
                    x2={chartRight}
                    y1={getY(activeCurrentPrice)}
                    y2={getY(activeCurrentPrice)}
                    stroke="#42F5B9"
                    strokeWidth="1"
                  />
                  <rect
                    x={chartRight + 2}
                    y={getY(activeCurrentPrice) - 9}
                    width={priceAxisWidth - 4}
                    height={18}
                    fill="#42F5B9"
                    rx="3"
                  />
                  <text
                    x={chartRight + (priceAxisWidth - 4) / 2}
                    y={getY(activeCurrentPrice) + 4}
                    fill="#000000"
                    fontSize={isMobile ? "8.5" : "10"}
                    fontWeight="700"
                    fontFamily="'JetBrains Mono', monospace"
                    textAnchor="middle"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatPrice(activeCurrentPrice)}
                  </text>
                </g>
              )}

              {/* Render Candlesticks */}
              {visibleKlines.map((candle, i) => {
                const x = i * candleSlot + candleSlot / 2;
                const isUp = candle.close >= candle.open;
                const color = isUp ? "#42F5B9" : "#FF5A6E";

                const yHigh = getY(candle.high);
                const yLow = getY(candle.low);
                const yOpen = getY(candle.open);
                const yClose = getY(candle.close);

                const bodyTop = Math.min(yOpen, yClose);
                const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));

                return (
                  <g key={candle.time}>
                    {/* High - Low Wick */}
                    <line
                      x1={x}
                      x2={x}
                      y1={yHigh}
                      y2={yLow}
                      stroke={color}
                      strokeWidth="1"
                    />
                    {/* Candle Body */}
                    <rect
                      x={x - candleWidth / 2}
                      y={bodyTop}
                      width={candleWidth}
                      height={bodyHeight}
                      fill={color}
                      rx="1"
                    />
                  </g>
                );
              })}

              {/* Bybit-style Visible Viewport Extremes (Lowest Price Marker) */}
              {lowestCandle && (
                (() => {
                  const candleX = lowestCandleIdx * candleSlot + candleSlot / 2;
                  const candleY = getY(lowestCandle.low);
                  const priceText = formatCryptoPrice(lowestCandle.low);
                  const charW = isMobile ? 5.8 : 6.8;
                  const textWidth = Math.max(isMobile ? 44 : 50, priceText.length * charW + 10);
                  const badgeH = isMobile ? 16 : 18;
                  const fontSize = isMobile ? "9" : "10";

                  const isNearRight = candleX > chartRight - textWidth - 25;
                  const isNearLeft = candleX < textWidth + 25;
                  const showToLeft = isNearRight && !isNearLeft;

                  return (
                    <g key={`min-${lowestCandle.time}`}>
                      {!showToLeft ? (
                        <>
                          {/* Arrow pointing LEFT to lowest wick tip */}
                          <path
                            d={`M ${candleX + 5} ${candleY - 3} L ${candleX} ${candleY} L ${candleX + 5} ${candleY + 3}`}
                            fill="none"
                            stroke="#A59CC4"
                            strokeWidth="1.2"
                          />
                          {/* Connecting line */}
                          <line
                            x1={candleX}
                            y1={candleY}
                            x2={candleX + 12}
                            y2={candleY}
                            stroke="#A59CC4"
                            strokeWidth="1"
                            strokeDasharray="2 2"
                          />
                          {/* Price Badge */}
                          <rect
                            x={candleX + 13}
                            y={candleY - badgeH / 2}
                            width={textWidth}
                            height={badgeH}
                            rx="3"
                            fill="#130F23EE"
                            stroke="#2A2145"
                            strokeWidth="0.8"
                          />
                          <text
                            x={candleX + 13 + textWidth / 2}
                            y={candleY + (isMobile ? 3 : 3.5)}
                            fill="#F1EEFF"
                            fontSize={fontSize}
                            fontFamily="'JetBrains Mono', monospace"
                            fontWeight="600"
                            textAnchor="middle"
                            style={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {priceText}
                          </text>
                        </>
                      ) : (
                        <>
                          {/* Arrow pointing RIGHT to lowest wick tip */}
                          <path
                            d={`M ${candleX - 5} ${candleY - 3} L ${candleX} ${candleY} L ${candleX - 5} ${candleY + 3}`}
                            fill="none"
                            stroke="#A59CC4"
                            strokeWidth="1.2"
                          />
                          {/* Connecting line */}
                          <line
                            x1={candleX - 12}
                            y1={candleY}
                            x2={candleX}
                            y2={candleY}
                            stroke="#A59CC4"
                            strokeWidth="1"
                            strokeDasharray="2 2"
                          />
                          {/* Price Badge */}
                          <rect
                            x={candleX - 13 - textWidth}
                            y={candleY - badgeH / 2}
                            width={textWidth}
                            height={badgeH}
                            rx="3"
                            fill="#130F23EE"
                            stroke="#2A2145"
                            strokeWidth="0.8"
                          />
                          <text
                            x={candleX - 13 - textWidth / 2}
                            y={candleY + (isMobile ? 3 : 3.5)}
                            fill="#F1EEFF"
                            fontSize={fontSize}
                            fontFamily="'JetBrains Mono', monospace"
                            fontWeight="600"
                            textAnchor="middle"
                            style={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {priceText}
                          </text>
                        </>
                      )}
                    </g>
                  );
                })()
              )}

              {/* Bybit-style Visible Viewport Extremes (Highest Price Marker) */}
              {highestCandle && highestCandleIdx !== lowestCandleIdx && (
                (() => {
                  const candleX = highestCandleIdx * candleSlot + candleSlot / 2;
                  const candleY = getY(highestCandle.high);
                  const priceText = formatCryptoPrice(highestCandle.high);
                  const charW = isMobile ? 5.8 : 6.8;
                  const textWidth = Math.max(isMobile ? 44 : 50, priceText.length * charW + 10);
                  const badgeH = isMobile ? 16 : 18;
                  const fontSize = isMobile ? "9" : "10";

                  const isNearRight = candleX > chartRight - textWidth - 25;
                  const isNearLeft = candleX < textWidth + 25;
                  const showToLeft = isNearRight && !isNearLeft;

                  return (
                    <g key={`max-${highestCandle.time}`}>
                      {!showToLeft ? (
                        <>
                          <path
                            d={`M ${candleX + 5} ${candleY - 3} L ${candleX} ${candleY} L ${candleX + 5} ${candleY + 3}`}
                            fill="none"
                            stroke="#A59CC4"
                            strokeWidth="1.2"
                          />
                          <line
                            x1={candleX}
                            y1={candleY}
                            x2={candleX + 12}
                            y2={candleY}
                            stroke="#A59CC4"
                            strokeWidth="1"
                            strokeDasharray="2 2"
                          />
                          <rect
                            x={candleX + 13}
                            y={candleY - badgeH / 2}
                            width={textWidth}
                            height={badgeH}
                            rx="3"
                            fill="#130F23EE"
                            stroke="#2A2145"
                            strokeWidth="0.8"
                          />
                          <text
                            x={candleX + 13 + textWidth / 2}
                            y={candleY + (isMobile ? 3 : 3.5)}
                            fill="#F1EEFF"
                            fontSize={fontSize}
                            fontFamily="'JetBrains Mono', monospace"
                            fontWeight="600"
                            textAnchor="middle"
                            style={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {priceText}
                          </text>
                        </>
                      ) : (
                        <>
                          <path
                            d={`M ${candleX - 5} ${candleY - 3} L ${candleX} ${candleY} L ${candleX - 5} ${candleY + 3}`}
                            fill="none"
                            stroke="#A59CC4"
                            strokeWidth="1.2"
                          />
                          <line
                            x1={candleX - 12}
                            y1={candleY}
                            x2={candleX}
                            y2={candleY}
                            stroke="#A59CC4"
                            strokeWidth="1"
                            strokeDasharray="2 2"
                          />
                          <rect
                            x={candleX - 13 - textWidth}
                            y={candleY - badgeH / 2}
                            width={textWidth}
                            height={badgeH}
                            rx="3"
                            fill="#130F23EE"
                            stroke="#2A2145"
                            strokeWidth="0.8"
                          />
                          <text
                            x={candleX - 13 - textWidth / 2}
                            y={candleY + (isMobile ? 3 : 3.5)}
                            fill="#F1EEFF"
                            fontSize={fontSize}
                            fontFamily="'JetBrains Mono', monospace"
                            fontWeight="600"
                            textAnchor="middle"
                            style={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {priceText}
                          </text>
                        </>
                      )}
                    </g>
                  );
                })()
              )}

              {/* Active Position Badge on Entry line */}
              {position && entry > 0 && (
                <g>
                  {(() => {
                    const sideText = position.side.toUpperCase();
                    const pnlSign = position.pnlUsdt >= 0 ? "+" : "";
                    const displayText = `${sideText} ${pnlSign}${position.pnlUsdt.toFixed(2)} USDT`;
                    const isLong = position.side === "long";
                    const accentColor = isLong ? "#35F2D0" : "#FF4F9A";
                    const badgeWidth = isMobile
                      ? Math.min(chartRight - 20, Math.max(110, displayText.length * 6.5 + 16))
                      : Math.max(140, displayText.length * 8.5 + 24);
                    const badgeX = isMobile ? 12 : Math.max(20, Math.min(chartRight - badgeWidth - 10, 420));
                    const badgeY = getY(entry) - 13;

                    return (
                      <g>
                        <rect
                          x={badgeX}
                          y={badgeY}
                          width={badgeWidth}
                          height={isMobile ? 22 : 26}
                          rx="5"
                          fill="#0E0B1A"
                          stroke={accentColor}
                          strokeWidth="1.2"
                        />
                        <text
                          x={badgeX + badgeWidth / 2}
                          y={badgeY + (isMobile ? 14 : 17)}
                          fill="#F1EEFF"
                          fontSize={isMobile ? "10" : "12"}
                          fontWeight="700"
                          fontFamily="'JetBrains Mono', monospace"
                          textAnchor="middle"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {displayText}
                        </text>
                      </g>
                    );
                  })()}
                </g>
              )}

              {/* Entry Arrow (Long = under candle pointing UP, Short = above candle pointing DOWN) */}
              {position && visibleKlines.length > 0 && (() => {
                let candleIdx = -1;
                if (position.openedAt) {
                  const openedTime = new Date(position.openedAt).getTime();
                  let closestDiff = Infinity;
                  visibleKlines.forEach((k, idx) => {
                    const diff = Math.abs(k.time - openedTime);
                    if (diff < closestDiff) {
                      closestDiff = diff;
                      candleIdx = idx;
                    }
                  });
                }
                if (candleIdx === -1) {
                  candleIdx = visibleKlines.length - 1;
                }

                const targetCandle = visibleKlines[candleIdx];
                if (!targetCandle) return null;

                const arrowX = candleIdx * candleSlot + candleSlot / 2;
                const isLong = position.side === "long";
                const arrowColor = isLong ? "#35F2D0" : "#FF4F9A";

                if (isLong) {
                  const yBase = getY(targetCandle.low) + 8;
                  if (yBase > chartBottom + 30) return null;
                  return (
                    <g filter={`drop-shadow(0 0 6px ${arrowColor}aa)`}>
                      <path
                        d={`M ${arrowX} ${yBase}
                            L ${arrowX - 6} ${yBase + 9}
                            L ${arrowX - 2.5} ${yBase + 9}
                            L ${arrowX - 2.5} ${yBase + 20}
                            L ${arrowX + 2.5} ${yBase + 20}
                            L ${arrowX + 2.5} ${yBase + 9}
                            L ${arrowX + 6} ${yBase + 9} Z`}
                        fill={arrowColor}
                      />
                    </g>
                  );
                } else {
                  const yBase = getY(targetCandle.high) - 8;
                  if (yBase < chartTop - 30) return null;
                  return (
                    <g filter={`drop-shadow(0 0 6px ${arrowColor}aa)`}>
                      <path
                        d={`M ${arrowX} ${yBase}
                            L ${arrowX - 6} ${yBase - 9}
                            L ${arrowX - 2.5} ${yBase - 9}
                            L ${arrowX - 2.5} ${yBase - 20}
                            L ${arrowX + 2.5} ${yBase - 20}
                            L ${arrowX + 2.5} ${yBase - 9}
                            L ${arrowX + 6} ${yBase - 9} Z`}
                        fill={arrowColor}
                      />
                    </g>
                  );
                }
              })()}

              {/* Historical Closed Trade Markers (Entry Arrow + Exit Marker + Path) */}
              {!position && closedPosition && visibleKlines.length > 0 && (() => {
                let entryIdx = -1;
                let exitIdx = -1;

                if (closedPosition.openedAt) {
                  const ot = new Date(closedPosition.openedAt).getTime();
                  let closestDiff = Infinity;
                  visibleKlines.forEach((k, idx) => {
                    const d = Math.abs(k.time - ot);
                    if (d < closestDiff) {
                      closestDiff = d;
                      entryIdx = idx;
                    }
                  });
                }
                if (entryIdx === -1) {
                  entryIdx = Math.max(0, visibleKlines.length - 15);
                }

                if (closedPosition.closedAt) {
                  const ct = new Date(closedPosition.closedAt).getTime();
                  let closestDiff = Infinity;
                  visibleKlines.forEach((k, idx) => {
                    const d = Math.abs(k.time - ct);
                    if (d < closestDiff) {
                      closestDiff = d;
                      exitIdx = idx;
                    }
                  });
                }
                if (exitIdx === -1 || exitIdx < entryIdx) {
                  exitIdx = visibleKlines.length - 1;
                }

                const entryCandle = visibleKlines[entryIdx];
                const exitCandle = visibleKlines[exitIdx];
                if (!entryCandle || !exitCandle) return null;

                const entryX = entryIdx * candleSlot + candleSlot / 2;
                const exitX = exitIdx * candleSlot + candleSlot / 2;
                const entryY = getY(closedPosition.entryPrice);
                const exitY = getY(closedPosition.exitPrice);

                const isLong = closedPosition.side === "long";
                const entryColor = isLong ? "#35F2D0" : "#FF4F9A";
                const isProfit = closedPosition.pnlUsdt >= 0;
                const outcomeColor = isProfit ? "#35F2D0" : "#FF4F9A";

                const exitBadgeText = `Вихід $${formatCryptoPrice(closedPosition.exitPrice)} (${isProfit ? "+" : ""}${closedPosition.pnlUsdt.toFixed(2)} USDT)`;
                const exitBadgeW = isMobile ? Math.min(chartRight - 20, 150) : Math.max(160, exitBadgeText.length * 8 + 20);
                const exitBadgeX = Math.max(8, Math.min(chartRight - exitBadgeW - 8, exitX - exitBadgeW / 2));
                const exitBadgeY = Math.max(chartTop + 4, Math.min(chartBottom - 30, exitY - 14));

                return (
                  <g>
                    {/* Connecting Trade Span Dashed Line */}
                    <line
                      x1={entryX}
                      y1={entryY}
                      x2={exitX}
                      y2={exitY}
                      stroke={outcomeColor}
                      strokeWidth="1.6"
                      strokeDasharray="4 4"
                      opacity="0.85"
                    />

                    {/* Entry Arrow on Entry Candle */}
                    <g filter={`drop-shadow(0 0 6px ${entryColor}aa)`}>
                      {isLong ? (
                        <path
                          d={`M ${entryX} ${getY(entryCandle.low) + 8}
                              L ${entryX - 6} ${getY(entryCandle.low) + 16}
                              L ${entryX - 2.5} ${getY(entryCandle.low) + 16}
                              L ${entryX - 2.5} ${getY(entryCandle.low) + 26}
                              L ${entryX + 2.5} ${getY(entryCandle.low) + 26}
                              L ${entryX + 2.5} ${getY(entryCandle.low) + 16}
                              L ${entryX + 6} ${getY(entryCandle.low) + 16} Z`}
                          fill={entryColor}
                        />
                      ) : (
                        <path
                          d={`M ${entryX} ${getY(entryCandle.high) - 8}
                              L ${entryX - 6} ${getY(entryCandle.high) - 16}
                              L ${entryX - 2.5} ${getY(entryCandle.high) - 16}
                              L ${entryX - 2.5} ${getY(entryCandle.high) - 26}
                              L ${entryX + 2.5} ${getY(entryCandle.high) - 26}
                              L ${entryX + 2.5} ${getY(entryCandle.high) - 16}
                              L ${entryX + 6} ${getY(entryCandle.high) - 16} Z`}
                          fill={entryColor}
                        />
                      )}
                    </g>

                    {/* Entry Label Badge */}
                    <rect
                      x={entryX - 40}
                      y={isLong ? getY(entryCandle.low) + 30 : getY(entryCandle.high) - 42}
                      width="80"
                      height="17"
                      rx="4"
                      fill="#0E0B1A"
                      stroke={entryColor}
                      strokeWidth="1"
                    />
                    <text
                      x={entryX}
                      y={isLong ? getY(entryCandle.low) + 42 : getY(entryCandle.high) - 30}
                      fill="#F1EEFF"
                      fontSize="9"
                      fontWeight="700"
                      textAnchor="middle"
                      fontFamily="'JetBrains Mono', monospace"
                    >
                      Вхід ${formatCryptoPrice(closedPosition.entryPrice)}
                    </text>

                    {/* Exit Target Marker Dot */}
                    <circle
                      cx={exitX}
                      cy={exitY}
                      r="5"
                      fill={outcomeColor}
                      stroke="#0E0B1A"
                      strokeWidth="2"
                      filter={`drop-shadow(0 0 6px ${outcomeColor})`}
                    />

                    {/* Exit Floating Outcome Badge */}
                    <rect
                      x={exitBadgeX}
                      y={exitBadgeY}
                      width={exitBadgeW}
                      height="22"
                      rx="5"
                      fill="#0E0B1A"
                      stroke={outcomeColor}
                      strokeWidth="1.2"
                    />
                    <text
                      x={exitBadgeX + exitBadgeW / 2}
                      y={exitBadgeY + 15}
                      fill="#F1EEFF"
                      fontSize={isMobile ? "9.5" : "11"}
                      fontWeight="700"
                      textAnchor="middle"
                      fontFamily="'JetBrains Mono', monospace"
                    >
                      {exitBadgeText}
                    </text>
                  </g>
                );
              })()}

              {/* Interactive Crosshair */}
              {hoverIndex !== null && hoverY !== null && (
                <g>
                  {/* Horizontal crosshair */}
                  <line
                    x1={0}
                    x2={chartRight}
                    y1={hoverY}
                    y2={hoverY}
                    stroke="#666666"
                    strokeWidth="0.8"
                    strokeDasharray="2 2"
                  />
                  {/* Price pill on right axis */}
                  <rect
                    x={chartRight + 2}
                    y={hoverY - 9}
                    width={priceAxisWidth - 4}
                    height={18}
                    fill="#251D3D"
                    stroke="#7C4DFF"
                    strokeWidth="1"
                    rx="3"
                  />
                  <text
                    x={chartRight + (priceAxisWidth - 4) / 2}
                    y={hoverY + 4}
                    fill="#F1EEFF"
                    fontSize={isMobile ? "8.5" : "10"}
                    fontFamily="'JetBrains Mono', monospace"
                    fontWeight="600"
                    textAnchor="middle"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatPrice(getPriceFromY(hoverY))}
                  </text>

                  {/* Vertical crosshair */}
                  {visibleKlines[hoverIndex] && (
                    <>
                      <line
                        x1={hoverIndex * candleSlot + candleSlot / 2}
                        x2={hoverIndex * candleSlot + candleSlot / 2}
                        y1={chartTop}
                        y2={chartBottom}
                        stroke="#666666"
                        strokeWidth="0.8"
                        strokeDasharray="2 2"
                      />
                      {/* Time pill on bottom axis */}
                      <rect
                        x={hoverIndex * candleSlot + candleSlot / 2 - (isMobile ? 24 : 28)}
                        y={chartBottom + 4}
                        width={isMobile ? 48 : 56}
                        height={18}
                        fill="#251D3D"
                        stroke="#7C4DFF"
                        strokeWidth="1"
                        rx="3"
                      />
                      <text
                        x={hoverIndex * candleSlot + candleSlot / 2}
                        y={chartBottom + 16}
                        fill="#F1EEFF"
                        fontSize={isMobile ? "8.5" : "9.5"}
                        fontWeight="600"
                        textAnchor="middle"
                        fontFamily="'JetBrains Mono', monospace"
                      >
                        {new Date(visibleKlines[hoverIndex].time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </text>
                    </>
                  )}
                </g>
              )}

              {/* Bottom Time Axis Labels */}
              {visibleKlines.filter((_, i) => i % Math.max(1, Math.round(visibleKlines.length / (isMobile ? 4 : 7))) === 0).map((k) => {
                const candleIdx = visibleKlines.indexOf(k);
                const x = candleIdx * candleSlot + candleSlot / 2;
                const date = new Date(k.time);
                const timeStr = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
                return (
                  <text
                    key={k.time}
                    x={x}
                    y={chartBottom + 16}
                    fill="#7D749C"
                    fontSize={isMobile ? "8.5" : "10"}
                    textAnchor="middle"
                    fontFamily="'JetBrains Mono', monospace"
                  >
                    {timeStr}
                  </text>
                );
              })}

              {/* TradingView-style Price Scale Auto Reset Pill in Corner */}
              <g
                onClick={handleResetPriceScale}
                style={{ cursor: "pointer" }}
              >
                <rect
                  x={chartRight + 2}
                  y={chartBottom + 4}
                  width={priceAxisWidth - 4}
                  height={18}
                  rx="3"
                  fill={isPriceScaleCustom ? "rgba(53, 242, 208, 0.16)" : "#130F23"}
                  stroke={isPriceScaleCustom ? "#35F2D0" : "#2A2145"}
                  strokeWidth={isPriceScaleCustom ? "1.2" : "0.8"}
                />
                <text
                  x={chartRight + (priceAxisWidth - 4) / 2}
                  y={chartBottom + 16}
                  fill={isPriceScaleCustom ? "#35F2D0" : "#8A82A5"}
                  fontSize={isMobile ? "8.5" : "9.5"}
                  fontWeight="700"
                  fontFamily="'JetBrains Mono', monospace"
                  textAnchor="middle"
                >
                  {isPriceScaleCustom ? "↺ Auto" : "Auto"}
                </text>
              </g>
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
