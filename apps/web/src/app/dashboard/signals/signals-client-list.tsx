"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { formatTimeAgo } from "../../../lib/date";
import { formatCryptoPrice } from "../../../lib/format";
import { confirmSignal } from "../chat/actions";
import { deleteSignalAction } from "../signal/[id]/actions";
import { ScanModalButton } from "./scan-modal";

interface SignalItem {
  id: string;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  stopLoss: number;
  tp1Price: number;
  leverage: number;
  qualityScore: string;
  qualityTier: string;
  strategy: string;
  winProb: number;
  rr: string;
  isArchived: boolean;
  remainingHours: number;
  createdAt: string;
  isHighVolatility?: boolean | undefined;
  change24hPct?: number | undefined;
  marketCategory: "moderate" | "trending";
  trade: {
    id: string;
    symbol: string;
    side: string;
    status: string;
    entry_avg: number;
    exit_price?: number | null;
    exit_reason?: string | null;
    realized_pnl: number;
    leverage: number;
    opened_at?: string | null;
    closed_at?: string | null;
  } | null;
  outcome: {
    status: string;
    outcome: string | null;
    failure_reason: string | null;
    max_favorable_pct: number;
    max_adverse_pct: number;
  } | null;
}

interface SignalsClientListProps {
  signals: SignalItem[];
  isArchive: boolean;
  isPaperTrading: boolean;
  initialSearchQuery?: string;
}

export function SignalsClientList({
  signals,
  isArchive,
  isPaperTrading,
  initialSearchQuery = ""
}: SignalsClientListProps) {
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Multi-condition filter state
  const [search, setSearch] = useState<string>(initialSearchQuery);
  const [coinCategory, setCoinCategory] = useState<"all" | "moderate" | "trending">("all");
  const [volatility, setVolatility] = useState<"all" | "with" | "without">("all");
  const [direction, setDirection] = useState<"all" | "long" | "short">("all");
  const [quality, setQuality] = useState<"all" | "tier_a" | "win_70">("all");
  const [tradeStatus, setTradeStatus] = useState<"all" | "available" | "in_trade" | "settled">("all");

  const isAnyFilterActive =
    search.trim() !== "" ||
    coinCategory !== "all" ||
    volatility !== "all" ||
    direction !== "all" ||
    quality !== "all" ||
    tradeStatus !== "all";

  const handleResetFilters = () => {
    setSearch("");
    setCoinCategory("all");
    setVolatility("all");
    setDirection("all");
    setQuality("all");
    setTradeStatus("all");
  };

  const filteredSignals = signals.filter((s) => {
    // 1. Text Search (symbol, base coin name, strategy, side, quality tier)
    if (search.trim()) {
      const rawQ = search.trim().toUpperCase();
      const cleanQ = rawQ.replace(/[^A-Z0-9]/g, "");
      const sym = s.symbol.toUpperCase();
      const symBase = sym.replace(/USDT$|PERP$|USDC$/, "");
      const strategy = s.strategy.toUpperCase();
      const side = s.side.toUpperCase();

      const matchSymbol =
        sym.includes(rawQ) ||
        (cleanQ.length > 0 && sym.includes(cleanQ)) ||
        symBase.includes(rawQ) ||
        (cleanQ.length > 0 && symBase.includes(cleanQ));
      const matchStrategy = strategy.includes(rawQ);
      const matchSide = (rawQ === "LONG" && side === "LONG") || (rawQ === "SHORT" && side === "SHORT");
      const matchQuality = (s.qualityTier || "").toUpperCase().includes(rawQ);

      if (!matchSymbol && !matchStrategy && !matchSide && !matchQuality) {
        return false;
      }
    }

    // 2. Coin Category (Dynamic): "Усі" vs "Помірні" (-5%..+5%) vs "Трендові" (>5% памп/дамп)
    if (coinCategory === "moderate" && s.marketCategory !== "moderate") {
      return false;
    }
    if (coinCategory === "trending" && s.marketCategory !== "trending") {
      return false;
    }

    // 3. Volatility (Independent filter: "Усі" vs "З волатильністю" vs "Без волатильності")
    if (volatility === "with" && !s.isHighVolatility) {
      return false;
    }
    if (volatility === "without" && s.isHighVolatility) {
      return false;
    }

    // 4. Direction
    if (direction !== "all" && s.side !== direction) {
      return false;
    }

    // 5. Quality / Win Rate
    if (quality === "tier_a") {
      const tier = (s.qualityTier || "").toUpperCase();
      if (!tier.includes("A")) return false;
    } else if (quality === "win_70") {
      if (s.winProb < 70) return false;
    }

    // 6. Trade Status
    const isTradeActive = s.trade?.status === "active" || s.trade?.status === "entry_open";
    const isTradeSettled = s.trade?.status === "closed";

    if (tradeStatus === "in_trade" && !isTradeActive) {
      return false;
    }
    if (tradeStatus === "settled" && !isTradeSettled) {
      return false;
    }
    if (tradeStatus === "available" && (isTradeActive || isTradeSettled)) {
      return false;
    }

    return true;
  });

  const handleDelete = (signalId: string) => {
    if (!confirm("Ви впевнені, що хочете видалити цей сигнал з архіву?")) return;
    setDeletingId(signalId);
    startTransition(async () => {
      try {
        await deleteSignalAction(signalId);
      } finally {
        setDeletingId(null);
      }
    });
  };

  if (signals.length === 0) {
    return (
      <div
        className="cd"
        style={{
          padding: "48px 24px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "12px"
        }}
      >
        <span style={{ fontSize: "32px" }}>{isArchive ? "📁" : "⚡"}</span>
        <b style={{ font: "700 18px Inter, sans-serif", color: "#FFFFFF" }}>
          {isArchive ? "В архіві немає збережених сигналів" : "Немає активних сигналів за останні 48 годин"}
        </b>
        <span className="lb" style={{ maxWidth: "420px" }}>
          {isArchive
            ? "Сигнали автоматично переміщуються сюди через 48 годин після створення та зберігаються безстроково."
            : "Натисніть «Сканувати Bybit 916 пар» угорі або перейдіть до Pulse, щоб згенерувати свіжі сетапи від ШІ."}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Scoped styles for responsive & accessible professional trading toolbar */}
      <style>{`
        .vx-filter-toolbar {
          background: #0E0B1A;
          border: 1px solid #2A2145;
          border-radius: 12px;
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
        }
        .vx-filter-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
        }
        .vx-search-box {
          position: relative;
          flex: 1 1 280px;
          max-width: 440px;
          display: flex;
          align-items: center;
        }
        .vx-search-box input[type="text"].vx-search-input,
        .vx-search-input {
          width: 100% !important;
          height: 38px !important;
          padding-left: 42px !important;
          padding-right: 36px !important;
          padding-top: 0 !important;
          padding-bottom: 0 !important;
          box-sizing: border-box !important;
          font-size: 13px !important;
          font-family: 'Plus Jakarta Sans', sans-serif !important;
          color: #F1EEFF !important;
          background: #130F23 !important;
          border: 1px solid #251E3D !important;
          border-radius: 8px !important;
          line-height: 38px !important;
          transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
        }
        .vx-search-box input[type="text"].vx-search-input:hover,
        .vx-search-input:hover {
          border-color: #382C58 !important;
        }
        .vx-search-box input[type="text"].vx-search-input:focus,
        .vx-search-input:focus {
          outline: none !important;
          border-color: #55418C !important;
          background: #171229 !important;
          box-shadow: 0 0 0 3px rgba(124, 77, 255, 0.12) !important;
        }
        .vx-search-box input[type="text"].vx-search-input::placeholder,
        .vx-search-input::placeholder {
          color: #6C6387 !important;
        }
        .vx-search-icon {
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          color: #6C6387;
          pointer-events: none;
          font-size: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2;
        }
        .vx-search-clear {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          background: transparent;
          border: none;
          color: #8E88A8;
          cursor: pointer;
          padding: 4px 6px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          transition: color 0.15s ease, background 0.15s ease;
        }
        .vx-search-clear:hover {
          color: #F1EEFF;
          background: rgba(255, 255, 255, 0.08);
        }
        .vx-filter-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .vx-counter-badge {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: #8E88A8;
          letter-spacing: -0.01em;
          background: #130F23;
          border: 1px solid #231B38;
          padding: 5px 10px;
          border-radius: 6px;
        }
        .vx-counter-badge b {
          color: #F1EEFF;
        }
        .vx-reset-btn {
          height: 30px;
          padding: 0 12px;
          font-size: 12px;
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-weight: 600;
          color: #FF7088;
          background: rgba(255, 90, 110, 0.08);
          border: 1px solid rgba(255, 90, 110, 0.25);
          border-radius: 6px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: all 0.15s ease;
        }
        .vx-reset-btn:hover {
          background: rgba(255, 90, 110, 0.16);
          border-color: rgba(255, 90, 110, 0.45);
          color: #FFA1B0;
        }
        .vx-filter-divider {
          height: 1px;
          background: #1C1630;
          width: 100%;
        }
        .vx-filter-groups {
          display: flex;
          align-items: stretch;
          gap: 16px;
          flex-wrap: wrap;
        }
        .vx-filter-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex: 1 1 200px;
        }
        .vx-filter-label {
          font-size: 11px;
          font-weight: 600;
          color: #8E88A8;
          font-family: 'Plus Jakarta Sans', sans-serif;
          letter-spacing: 0.02em;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .vx-segmented-well {
          display: flex;
          align-items: center;
          background: #130F23;
          border: 1px solid #231B38;
          border-radius: 8px;
          padding: 3px;
          gap: 2px;
        }
        .vx-seg-btn {
          flex: 1 1 auto;
          height: 30px;
          padding: 0 10px;
          font-size: 11.5px;
          font-weight: 600;
          font-family: 'Plus Jakarta Sans', sans-serif;
          color: #8E88A8;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 6px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          white-space: nowrap;
          transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
          user-select: none;
        }
        .vx-seg-btn:hover:not(.active) {
          color: #E2DCFA;
          background: rgba(255, 255, 255, 0.04);
        }
        .vx-seg-btn:focus-visible {
          outline: 2px solid rgba(124, 77, 255, 0.5);
          outline-offset: 1px;
        }
        /* Active states: restrained, subtle depth without harsh neon */
        .vx-seg-btn.active.neutral {
          background: #251D3D;
          border-color: #493976;
          color: #F1EEFF;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
        }
        .vx-seg-btn.active.cat-mod {
          background: rgba(53, 242, 208, 0.10);
          border-color: rgba(53, 242, 208, 0.35);
          color: #35F2D0;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        }
        .vx-seg-btn.active.cat-trend {
          background: rgba(185, 162, 255, 0.12);
          border-color: rgba(185, 162, 255, 0.35);
          color: #B9A2FF;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        }
        .vx-seg-btn.active.vol-with {
          background: rgba(255, 194, 75, 0.12);
          border-color: rgba(255, 194, 75, 0.35);
          color: #FFC24B;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        }
        .vx-seg-btn.active.vol-without {
          background: rgba(53, 242, 208, 0.10);
          border-color: rgba(53, 242, 208, 0.35);
          color: #35F2D0;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        }
        .vx-seg-btn.active.long {
          background: rgba(53, 242, 208, 0.12);
          border-color: rgba(53, 242, 208, 0.35);
          color: #35F2D0;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        }
        .vx-seg-btn.active.short {
          background: rgba(255, 79, 154, 0.12);
          border-color: rgba(255, 79, 154, 0.35);
          color: #FF4F9A;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        }
        .vx-seg-btn.active.quality-tier {
          background: rgba(245, 196, 81, 0.12);
          border-color: rgba(245, 196, 81, 0.32);
          color: #F5C451;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        }
        .vx-seg-btn.active.quality-win {
          background: rgba(53, 242, 208, 0.10);
          border-color: rgba(53, 242, 208, 0.32);
          color: #35F2D0;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        }
        .vx-seg-btn.active.status-active {
          background: rgba(53, 242, 208, 0.10);
          border-color: rgba(53, 242, 208, 0.32);
          color: #35F2D0;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        }
        .vx-seg-btn.active.status-avail {
          background: rgba(185, 162, 255, 0.12);
          border-color: rgba(185, 162, 255, 0.32);
          color: #B9A2FF;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        }
        .vx-seg-btn.active.status-settled {
          background: rgba(185, 162, 255, 0.14);
          border-color: rgba(185, 162, 255, 0.38);
          color: #B9A2FF;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        }
        @media (max-width: 768px) {
          .vx-filter-toolbar {
            padding: 14px;
            gap: 12px;
          }
          .vx-filter-topbar {
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
          }
          .vx-search-box {
            max-width: 100%;
          }
          .vx-filter-meta {
            justify-content: space-between;
          }
          .vx-filter-groups {
            display: grid;
            grid-template-columns: 1fr;
            gap: 12px;
          }
          .vx-seg-btn {
            height: 34px;
            font-size: 12px;
          }
        }
        @media (min-width: 769px) and (max-width: 1100px) {
          .vx-filter-groups {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
          }
        }
      `}</style>

      {/* Interactive Multi-Condition Filter Toolbar */}
      <div className="vx-filter-toolbar">
        {/* Top Bar: Search Input & Telemetry/Reset */}
        <div className="vx-filter-topbar">
          <div className="vx-search-box">
            <span className="vx-search-icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Пошук за символом або стратегією (BTC, SOL, QUSDT, FVG...)..."
              className="vx-search-input"
              style={{
                paddingLeft: "42px",
                paddingRight: search ? "36px" : "14px",
                boxSizing: "border-box"
              }}
              aria-label="Пошук сигналів"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="vx-search-clear"
                title="Очистити пошук"
                aria-label="Очистити пошук"
              >
                ✕
              </button>
            ) : null}
          </div>

          <div className="vx-filter-meta">
            <span className="vx-counter-badge">
              Показано: <b>{filteredSignals.length}</b> із {signals.length}
            </span>
            {isAnyFilterActive ? (
              <button
                type="button"
                onClick={handleResetFilters}
                className="vx-reset-btn"
                title="Скинути всі активні фільтри"
              >
                ↺ Скинути фільтри
              </button>
            ) : null}
          </div>
        </div>

        <div className="vx-filter-divider" />

        {/* Bottom Bar: Segmented Condition Controls */}
        <div className="vx-filter-groups">
          {/* Coin Category Filter */}
          <div className="vx-filter-group">
            <label className="vx-filter-label">Категорія монет</label>
            <div className="vx-segmented-well" role="group" aria-label="Фільтр категорії монет">
              <button
                type="button"
                onClick={() => setCoinCategory("all")}
                className={`vx-seg-btn ${coinCategory === "all" ? "active neutral" : ""}`}
              >
                Усі
              </button>
              <button
                type="button"
                onClick={() => setCoinCategory("moderate")}
                className={`vx-seg-btn ${coinCategory === "moderate" ? "active cat-mod" : ""}`}
                title="Помірні монети із 24h динамікою в межах -5%..+5% (SOL, PEPE, LINK, UNI, NEAR, SUI...)"
              >
                <span>🛡️</span> Помірні
              </button>
              <button
                type="button"
                onClick={() => setCoinCategory("trending")}
                className={`vx-seg-btn ${coinCategory === "trending" ? "active cat-trend" : ""}`}
                title="Трендові монети з сильним процентом зміни (>5% памп/дамп)"
              >
                <span>🚀</span> Трендові
              </button>
            </div>
          </div>

          {/* Volatility Filter (Independent) */}
          <div className="vx-filter-group">
            <label className="vx-filter-label">Волатильність</label>
            <div className="vx-segmented-well" role="group" aria-label="Фільтр волатильності">
              <button
                type="button"
                onClick={() => setVolatility("all")}
                className={`vx-seg-btn ${volatility === "all" ? "active neutral" : ""}`}
              >
                Усі
              </button>
              <button
                type="button"
                onClick={() => setVolatility("with")}
                className={`vx-seg-btn ${volatility === "with" ? "active vol-with" : ""}`}
                title="Тільки пари з високою волатильністю (різкі стрибки ціни за 1 секунду)"
              >
                <span>⚡</span> З волатильністю
              </button>
              <button
                type="button"
                onClick={() => setVolatility("without")}
                className={`vx-seg-btn ${volatility === "without" ? "active vol-without" : ""}`}
                title="Спокійні свічки без різких секундних коливань"
              >
                Без волатильності
              </button>
            </div>
          </div>

          {/* Direction Filter */}
          <div className="vx-filter-group">
            <label className="vx-filter-label">Напрямок</label>
            <div className="vx-segmented-well" role="group" aria-label="Фільтр напрямку">
              <button
                type="button"
                onClick={() => setDirection("all")}
                className={`vx-seg-btn ${direction === "all" ? "active neutral" : ""}`}
              >
                Всі
              </button>
              <button
                type="button"
                onClick={() => setDirection("long")}
                className={`vx-seg-btn ${direction === "long" ? "active long" : ""}`}
              >
                <span style={{ color: "#35F2D0" }}>●</span> Long
              </button>
              <button
                type="button"
                onClick={() => setDirection("short")}
                className={`vx-seg-btn ${direction === "short" ? "active short" : ""}`}
              >
                <span style={{ color: "#FF4F9A" }}>●</span> Short
              </button>
            </div>
          </div>

          {/* Quality & Win Rate Filter */}
          <div className="vx-filter-group">
            <label className="vx-filter-label">Якість ШІ</label>
            <div className="vx-segmented-well" role="group" aria-label="Фільтр якості та ймовірності ШІ">
              <button
                type="button"
                onClick={() => setQuality("all")}
                className={`vx-seg-btn ${quality === "all" ? "active neutral" : ""}`}
              >
                Всі
              </button>
              <button
                type="button"
                onClick={() => setQuality("tier_a")}
                className={`vx-seg-btn ${quality === "tier_a" ? "active quality-tier" : ""}`}
                title="Найвищий рейтинговий рівень сетапів (A+/A)"
              >
                <span>★</span> Tier A+/A
              </button>
              <button
                type="button"
                onClick={() => setQuality("win_70")}
                className={`vx-seg-btn ${quality === "win_70" ? "active quality-win" : ""}`}
                title="Ймовірність успіху за оцінкою моделі від 70%"
              >
                <span>🎯</span> Win ≥ 70%
              </button>
            </div>
          </div>

          {/* Position Status Filter */}
          <div className="vx-filter-group">
            <label className="vx-filter-label">Статус позиції</label>
            <div className="vx-segmented-well" role="group" aria-label="Фільтр статусу позиції">
              <button
                type="button"
                onClick={() => setTradeStatus("all")}
                className={`vx-seg-btn ${tradeStatus === "all" ? "active neutral" : ""}`}
              >
                Всі
              </button>
              <button
                type="button"
                onClick={() => setTradeStatus("available")}
                className={`vx-seg-btn ${tradeStatus === "available" ? "active status-avail" : ""}`}
                title="Нові сетапи, по яких ще не було входу"
              >
                ⚡ Доступні
              </button>
              <button
                type="button"
                onClick={() => setTradeStatus("in_trade")}
                className={`vx-seg-btn ${tradeStatus === "in_trade" ? "active status-active" : ""}`}
                title="Сигнали з відкритою позицією прямо зараз"
              >
                🎯 В трейді
              </button>
              <button
                type="button"
                onClick={() => setTradeStatus("settled")}
                className={`vx-seg-btn ${tradeStatus === "settled" ? "active status-settled" : ""}`}
                title="Сигнали, по яких уже відкрито і закрито угоду"
              >
                ✓ Відпрацьовані
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filtered Empty State */}
      {filteredSignals.length === 0 ? (
        <div
          className="cd"
          style={{
            padding: "44px 24px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
            background: "#0E0B1A",
            border: "1px solid #2A2145",
            borderRadius: "12px"
          }}
        >
          <span style={{ fontSize: "32px" }}>🔍</span>
          <b style={{ font: "700 16px Inter, sans-serif", color: "#FFFFFF" }}>
            За обраними фільтрами не знайдено жодного сигналу
          </b>
          <span className="lb" style={{ maxWidth: "480px", fontSize: "13px", lineHeight: "1.5" }}>
            {search.trim() ? (
              <>
                Серед <b>{signals.length}</b> сигналів немає сетапу для «<b>{search.trim()}</b>».
                {isAnyFilterActive && (coinCategory !== "all" || volatility !== "all" || direction !== "all") ? (
                  <> Можливо, цей сетап приховано іншими фільтрами (категорія монет або волатильність).</>
                ) : null}
              </>
            ) : (
              "Спробуйте змінити фільтри категорії, волатильності, напрямку або скинути параметри пошуку."
            )}
          </span>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center", marginTop: "6px" }}>
            {search.trim() ? (
              <ScanModalButton
                symbol={search.trim()}
                buttonText={`⚡ Просканувати ${search.trim().toUpperCase()} на Bybit`}
                className="bt sm pr"
                style={{
                  background: "linear-gradient(135deg, #7C4DFF 0%, #B24BFF 100%)",
                  border: "none",
                  color: "#FFFFFF",
                  fontWeight: 600,
                  padding: "8px 16px",
                  borderRadius: "8px"
                }}
              />
            ) : null}

            {isAnyFilterActive ? (
              <button
                type="button"
                onClick={handleResetFilters}
                className="bt sm"
                style={{
                  background: "#1A142E",
                  border: "1px solid #382C58",
                  color: "#F1EEFF",
                  padding: "8px 16px",
                  borderRadius: "8px",
                  cursor: "pointer"
                }}
              >
                ↺ Скинути всі фільтри
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Signals Cards */}
      {filteredSignals.map((s) => {
        const isLong = s.side === "long";
        const hasTrade = Boolean(s.trade);
        const isTradeActive = s.trade?.status === "active" || s.trade?.status === "entry_open";
        const isTradeSettled = s.trade?.status === "closed";
        const realizedPnl = Number(s.trade?.realized_pnl ?? 0);
        const isProfit = realizedPnl >= 0;

        // Distinct border & card styling based on trading lifecycle
        let cardBorder = "1px solid #231B38";
        let cardBackground = "#0E0B1A";
        let cardShadow = "none";

        if (isTradeActive) {
          cardBorder = "1px solid #35F2D0";
          cardShadow = "0 0 20px rgba(53, 242, 208, 0.08)";
        } else if (isTradeSettled) {
          cardBackground = "#0B0818";
          if (isProfit) {
            cardBorder = "1px solid rgba(53, 242, 208, 0.45)";
            cardShadow = "0 0 20px rgba(53, 242, 208, 0.06)";
          } else {
            cardBorder = "1px solid rgba(255, 79, 154, 0.45)";
            cardShadow = "0 0 20px rgba(255, 79, 154, 0.06)";
          }
        }

        return (
          <article
            key={s.id}
            className="cd"
            style={{
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              border: cardBorder,
              background: cardBackground,
              boxShadow: cardShadow,
              transition: "border-color 0.2s ease, box-shadow 0.2s ease"
            }}
          >
            {/* Top Bar: Symbol, Badges, Status Pill & Time */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <Link
                  href={`/dashboard/signal/${s.id}`}
                  style={{ font: "700 18px Inter, sans-serif", color: "#FFFFFF", textDecoration: "none" }}
                  className="hover:underline"
                >
                  {s.symbol}
                </Link>

                <span className={`tg ${isLong ? "lg" : "sh"}`}>
                  {s.side.toUpperCase()} {s.leverage}x
                </span>

                <span className="tg gy" style={{ color: "#F5C451" }}>
                  ★ {s.qualityScore} {s.qualityTier}
                </span>

                {/* Coin Category Badge: Moderate vs Trending */}
                {s.change24hPct !== undefined ? (
                  <span
                    className="tg"
                    style={{
                      background: s.marketCategory === "moderate" ? "rgba(53, 242, 208, 0.1)" : s.change24hPct > 0 ? "rgba(185, 162, 255, 0.12)" : "rgba(255, 79, 154, 0.12)",
                      color: s.marketCategory === "moderate" ? "#35F2D0" : s.change24hPct > 0 ? "#B9A2FF" : "#FF4F9A",
                      border: s.marketCategory === "moderate" ? "1px solid rgba(53, 242, 208, 0.3)" : "1px solid rgba(185, 162, 255, 0.3)",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "11px",
                      padding: "2px 6px"
                    }}
                    title={s.marketCategory === "moderate" ? "Помірна 24h динаміка (-5%..+5%)" : "Трендова 24h динаміка"}
                  >
                    {s.marketCategory === "moderate" ? "🛡️ " : "🚀 "}
                    {s.change24hPct >= 0 ? "+" : ""}{s.change24hPct.toFixed(1)}% 24h
                  </span>
                ) : (
                  <span
                    className="tg"
                    style={{
                      background: s.marketCategory === "moderate" ? "rgba(53, 242, 208, 0.1)" : "rgba(185, 162, 255, 0.12)",
                      color: s.marketCategory === "moderate" ? "#35F2D0" : "#B9A2FF",
                      border: s.marketCategory === "moderate" ? "1px solid rgba(53, 242, 208, 0.25)" : "1px solid rgba(185, 162, 255, 0.25)",
                      fontSize: "11px",
                      padding: "2px 6px"
                    }}
                  >
                    {s.marketCategory === "moderate" ? "🛡️ Помірна" : "🚀 Трендова"}
                  </span>
                )}

                {/* High Volatility Badge (Independent) */}
                {s.isHighVolatility ? (
                  <span
                    className="tg"
                    style={{
                      background: "rgba(255, 194, 75, 0.15)",
                      color: "#FFC24B",
                      border: "1px solid rgba(255, 194, 75, 0.4)",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px"
                    }}
                    title="Підвищена волатильність: швидкі коливання ціни за 1 секунду"
                  >
                    ⚡ Висока волатильність
                  </span>
                ) : null}

                {/* Status Badges: In-Trade (Active) vs Settled (Closed) */}
                {isTradeActive ? (
                  <span
                    className="tg lg"
                    style={{
                      background: "rgba(53, 242, 208, 0.14)",
                      border: "1px solid rgba(53, 242, 208, 0.45)",
                      color: "#35F2D0",
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px"
                    }}
                  >
                    <span>🎯 В трейді:</span>
                    <span>{isPaperTrading ? "Paper" : "Live"}</span>
                    <span style={{ fontFamily: "JetBrains Mono, monospace" }}>
                      (${formatCryptoPrice(s.trade?.entry_avg ?? s.entryPrice)})
                    </span>
                  </span>
                ) : isTradeSettled ? (
                  <span
                    className="tg"
                    style={{
                      background: isProfit ? "rgba(53, 242, 208, 0.14)" : "rgba(255, 79, 154, 0.14)",
                      border: `1px solid ${isProfit ? "rgba(53, 242, 208, 0.45)" : "rgba(255, 79, 154, 0.45)"}`,
                      color: isProfit ? "#35F2D0" : "#FF4F9A",
                      fontWeight: 700,
                      fontSize: "12px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px"
                    }}
                    title={`Угода за цим сигналом уже завершена. Результат: ${isProfit ? "+" : ""}${realizedPnl.toFixed(2)} USDT`}
                  >
                    <span>✓ Відпрацьовано:</span>
                    <b style={{ fontFamily: "JetBrains Mono, monospace" }}>
                      {isProfit ? "+" : ""}${realizedPnl.toFixed(2)} USDT
                    </b>
                    {s.trade?.exit_price ? (
                      <span style={{ opacity: 0.85, fontSize: "11px", fontWeight: 500 }}>
                        (вихід ${formatCryptoPrice(s.trade.exit_price)})
                      </span>
                    ) : null}
                  </span>
                ) : null}

                {s.outcome ? (
                  <span className={`tg ${s.outcome.outcome === "win" ? "lg" : s.outcome.outcome === "loss" ? "sh" : "gy"}`}>
                    ML: {s.outcome.status.replaceAll("_", " ")}
                    {s.outcome.failure_reason ? ` · ${s.outcome.failure_reason.replaceAll("_", " ")}` : ""}
                  </span>
                ) : null}
              </div>

              {/* Status / Expiry / Time */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                {isTradeSettled ? (
                  <span
                    className="tg"
                    style={{
                      background: "rgba(185, 162, 255, 0.08)",
                      color: "#B9A2FF",
                      border: "1px solid rgba(185, 162, 255, 0.25)",
                      fontSize: "11px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px"
                    }}
                    title="Цей сетап уже відпрацьовано. Повторний вхід заблоковано, очікуйте новий сигнал."
                  >
                    <span>🔒</span> Вхід закритий
                  </span>
                ) : s.isArchived ? (
                  <span className="tg gy" style={{ color: "#FF5A6E", border: "1px solid #FF5A6E33" }}>
                    📁 Не актуально (в архіві)
                  </span>
                ) : (
                  <span className="tg lg">
                    🟢 Актуально (ще {s.remainingHours}г)
                  </span>
                )}

                <span className="lb" style={{ fontSize: "12px" }}>
                  {s.trade?.closed_at ? `Закрито ${formatTimeAgo(s.trade.closed_at)}` : formatTimeAgo(s.createdAt)}
                </span>
              </div>
            </div>

            {/* Strategy Rationale */}
            <div style={{ font: "500 13px Inter, sans-serif", color: "#9A9A9A" }}>
              {s.strategy}
            </div>

            {/* Numbers Strip (Entry, SL, TP1, R:R, Win Rate) */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                gap: "8px",
                background: "#130F23",
                padding: "10px 14px",
                borderRadius: "6px",
                border: "1px solid #231B38"
              }}
            >
              <div>
                <div className="lb" style={{ fontSize: "11px" }}>Ціна входу</div>
                <div className="v" style={{ fontSize: "14px", margin: "2px 0 0" }}>
                  {s.entryPrice > 0 ? `$${formatCryptoPrice(s.entryPrice)}` : "Market"}
                </div>
              </div>
              <div>
                <div className="lb" style={{ fontSize: "11px" }}>Stop Loss</div>
                <div className="v" style={{ fontSize: "14px", margin: "2px 0 0", color: "#FF5A6E" }}>
                  {s.stopLoss > 0 ? `$${formatCryptoPrice(s.stopLoss)}` : "—"}
                </div>
              </div>
              <div>
                <div className="lb" style={{ fontSize: "11px" }}>Take Profit 1</div>
                <div className="v" style={{ fontSize: "14px", margin: "2px 0 0", color: "#42F5B9" }}>
                  {s.tp1Price > 0 ? `$${formatCryptoPrice(s.tp1Price)}` : "—"}
                </div>
              </div>
              <div>
                <div className="lb" style={{ fontSize: "11px" }}>R : R коефіцієнт</div>
                <div className="v" style={{ fontSize: "14px", margin: "2px 0 0", color: "#42F5B9" }}>
                  1 : {s.rr}
                </div>
              </div>
              <div>
                <div className="lb" style={{ fontSize: "11px" }}>Шанс успіху (Win)</div>
                <div className="v" style={{ fontSize: "14px", margin: "2px 0 0" }}>
                  {s.winProb}%
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", marginTop: "4px" }}>
              <div>
                {isTradeSettled ? (
                  <span
                    style={{
                      fontSize: "12px",
                      color: "#8E88A8",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px"
                    }}
                  >
                    <span style={{ color: "#B9A2FF" }}>🔒</span>
                    <span>Сетап відпрацьовано по цих даних. Повторний вхід заблоковано.</span>
                  </span>
                ) : isTradeActive ? (
                  <span
                    style={{
                      fontSize: "12px",
                      color: "#35F2D0",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px"
                    }}
                  >
                    <span>⚡</span>
                    <span>Позиція активна на терміналі</span>
                  </span>
                ) : (
                  <span style={{ fontSize: "12px", color: "#6C6387" }}>
                    Сигнал активний для виконання
                  </span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                {isArchive ? (
                  <button
                    type="button"
                    disabled={isPending && deletingId === s.id}
                    onClick={() => handleDelete(s.id)}
                    className="bt sm"
                    style={{ color: "#FF5A6E", borderColor: "#FF5A6E33" }}
                  >
                    {deletingId === s.id ? "Видаляю..." : "🗑️ Видалити з архіву"}
                  </button>
                ) : null}

                <Link
                  href={`/dashboard/signal/${s.id}`}
                  className="bt sm"
                  style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  <span>{isTradeSettled ? "Звіт відпрацювання" : "Відкрити термінал"}</span>
                  <span style={{ fontSize: "13px" }}>↗</span>
                </Link>

                {!isArchive && !hasTrade ? (
                  <form
                    action={confirmSignal}
                    onSubmit={() => setSubmittingId(s.id)}
                  >
                    <input type="hidden" name="signalId" value={s.id} />
                    <input type="hidden" name="margin" value={100} />
                    <button
                      type="submit"
                      className="bt pr sm"
                      disabled={isPending && submittingId === s.id}
                    >
                      {submittingId === s.id ? "⏳ Відкриваю..." : "⚡ Увійти ($100)"}
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
