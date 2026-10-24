"use client";

import { useMemo, useState } from "react";
import type { TradeRow } from "@crypto-bot/shared";
import { DayTradesModal } from "./day-trades-modal";

interface TradingCalendarProps {
  trades: TradeRow[];
}

interface DayAggregate {
  dateStr: string;
  dayNum: number;
  trades: TradeRow[];
  netPnl: number;
  wins: number;
  losses: number;
}

const MONTH_NAMES_UK = [
  "Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
  "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"
];

const WEEK_DAYS_UK = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

function getTradeDateKey(trade: TradeRow): string {
  const raw = trade.closed_at || trade.opened_at;
  if (!raw) return "";
  const d = new Date(raw);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function TradingCalendar({ trades }: TradingCalendarProps) {
  const today = useMemo(() => new Date(), []);

  // Determine initial year/month (prefer most recent trade date if available)
  const initialDate = useMemo(() => {
    if (trades.length > 0) {
      const firstValid = trades.find((t) => t.closed_at || t.opened_at);
      if (firstValid) {
        return new Date(firstValid.closed_at || firstValid.opened_at || Date.now());
      }
    }
    return today;
  }, [trades, today]);

  const [currentYear, setCurrentYear] = useState<number>(initialDate.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(initialDate.getMonth()); // 0-11
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Group all trades by date
  const tradesByDate = useMemo(() => {
    const map = new Map<string, TradeRow[]>();
    for (const t of trades) {
      const key = getTradeDateKey(t);
      if (!key) continue;
      const list = map.get(key) || [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [trades]);

  // Aggregate stats for the currently selected month
  const monthStats = useMemo(() => {
    let totalPnl = 0;
    let tradingDays = 0;
    let profitDays = 0;
    let lossDays = 0;
    let totalMonthTrades = 0;
    let bestDayPnl = -Infinity;

    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayTrades = tradesByDate.get(dateKey);
      if (dayTrades && dayTrades.length > 0) {
        tradingDays++;
        totalMonthTrades += dayTrades.length;
        const dayPnl = dayTrades.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0);
        totalPnl += dayPnl;
        if (dayPnl > 0) profitDays++;
        else if (dayPnl < 0) lossDays++;
        if (dayPnl > bestDayPnl) bestDayPnl = dayPnl;
      }
    }

    return {
      totalPnl,
      tradingDays,
      profitDays,
      lossDays,
      totalMonthTrades,
      bestDayPnl: bestDayPnl === -Infinity ? 0 : bestDayPnl,
      winRate: tradingDays > 0 ? ((profitDays / tradingDays) * 100).toFixed(0) : "0"
    };
  }, [tradesByDate, currentYear, currentMonth]);

  // Generate calendar grid days
  const calendarDays = useMemo(() => {
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
    // Monday as first day: (0 is Sunday, so convert Sunday=6, Mon=0, ..., Sat=5)
    const startOffset = (firstDayIndex + 6) % 7;

    const days: Array<DayAggregate | null> = [];

    // Padding before 1st of month
    for (let i = 0; i < startOffset; i++) {
      days.push(null);
    }

    // Days of month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayTrades = tradesByDate.get(dateKey) || [];
      let netPnl = 0;
      let wins = 0;
      let losses = 0;

      for (const t of dayTrades) {
        const pnl = Number(t.realized_pnl ?? 0);
        netPnl += pnl;
        if (pnl > 0) wins++;
        else if (pnl < 0) losses++;
      }

      days.push({
        dateStr: dateKey,
        dayNum: day,
        trades: dayTrades,
        netPnl,
        wins,
        losses
      });
    }

    return days;
  }, [currentYear, currentMonth, tradesByDate]);

  // Month navigation
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleToday = () => {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
  };

  const selectedDayTrades = selectedDate ? (tradesByDate.get(selectedDate) || []) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}>
      {/* Month Header & Summary Statistics Bar */}
      <div
        className="cd"
        style={{
          padding: "16px 20px",
          background: "#0E0B1A",
          border: "1px solid #2A2145",
          display: "flex",
          flexDirection: "column",
          gap: "16px"
        }}
      >
        {/* Navigation & Month Selector */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "20px" }}>📅</span>
            <h2 style={{ margin: 0, font: "700 20px Inter, sans-serif", color: "#FFFFFF" }}>
              {MONTH_NAMES_UK[currentMonth]} {currentYear}
            </h2>
            <span className="tg gy" style={{ color: "#B9A2FF", border: "1px solid #7C4DFF44", fontSize: "11px" }}>
              Торговий PnL Календар
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <button
              type="button"
              onClick={handlePrevMonth}
              className="bt sm"
              style={{ padding: "6px 12px", fontSize: "13px" }}
              title="Попередній місяць"
            >
              ←
            </button>
            <button
              type="button"
              onClick={handleToday}
              className="bt sm"
              style={{ padding: "6px 12px", fontSize: "12px" }}
              title="Поточний місяць"
            >
              Сьогодні
            </button>
            <button
              type="button"
              onClick={handleNextMonth}
              className="bt sm"
              style={{ padding: "6px 12px", fontSize: "13px" }}
              title="Наступний місяць"
            >
              →
            </button>
          </div>
        </div>

        {/* Quick Month Metrics Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "10px",
            background: "#141026",
            padding: "12px 16px",
            borderRadius: "6px",
            border: "1px solid #231B3D"
          }}
        >
          <div>
            <div className="lb" style={{ fontSize: "11px" }}>Підсумок місяця (PnL)</div>
            <div
              style={{
                font: "700 17px JetBrains Mono, monospace",
                margin: "2px 0 0",
                color: monthStats.totalPnl >= 0 ? "#35F2D0" : "#FF4F9A"
              }}
            >
              {monthStats.totalPnl >= 0 ? "+" : ""}{monthStats.totalPnl.toFixed(2)} USDT
            </div>
          </div>

          <div>
            <div className="lb" style={{ fontSize: "11px" }}>Дні торгів</div>
            <div className="v" style={{ fontSize: "15px", margin: "2px 0 0", color: "#FFFFFF" }}>
              {monthStats.tradingDays} дн. ({monthStats.profitDays} приб. / {monthStats.lossDays} збит.)
            </div>
          </div>

          <div>
            <div className="lb" style={{ fontSize: "11px" }}>Вінрейт днів</div>
            <div
              className="v"
              style={{
                fontSize: "15px",
                margin: "2px 0 0",
                color: Number(monthStats.winRate) >= 50 ? "#35F2D0" : "#FF4F9A"
              }}
            >
              {monthStats.winRate}% ({monthStats.totalMonthTrades} угод)
            </div>
          </div>

          <div>
            <div className="lb" style={{ fontSize: "11px" }}>Найкращий день</div>
            <div
              style={{
                font: "700 15px JetBrains Mono, monospace",
                margin: "2px 0 0",
                color: monthStats.bestDayPnl > 0 ? "#B9A2FF" : "#A59CC4"
              }}
            >
              {monthStats.bestDayPnl > 0 ? `+$${monthStats.bestDayPnl.toFixed(2)}` : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Calendar Grid Card */}
      <div
        className="cd"
        style={{
          padding: "16px",
          background: "#07050F",
          border: "1px solid #2A2145",
          overflowX: "auto"
        }}
      >
        <div style={{ minWidth: "640px" }}>
          {/* Days of Week Header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: "8px",
              marginBottom: "8px"
            }}
          >
            {WEEK_DAYS_UK.map((dayName, idx) => (
              <div
                key={dayName}
                style={{
                  textAlign: "center",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: idx >= 5 ? "#B9A2FF" : "#A59CC4",
                  padding: "4px 0"
                }}
              >
                {dayName}
              </div>
            ))}
          </div>

          {/* Calendar Day Tiles Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: "8px"
            }}
          >
            {calendarDays.map((day, index) => {
              if (!day) {
                return (
                  <div
                    key={`empty-${index}`}
                    style={{
                      minHeight: "88px",
                      background: "transparent",
                      border: "1px dashed #1B152E",
                      borderRadius: "6px",
                      opacity: 0.25
                    }}
                  />
                );
              }

              const hasTrades = day.trades.length > 0;
              const isProfit = hasTrades && day.netPnl > 0;
              const isLoss = hasTrades && day.netPnl < 0;
              const isEven = hasTrades && day.netPnl === 0;

              const isCurrentDay =
                today.getFullYear() === currentYear &&
                today.getMonth() === currentMonth &&
                today.getDate() === day.dayNum;

              return (
                <div
                  key={day.dateStr}
                  onClick={() => {
                    if (hasTrades) setSelectedDate(day.dateStr);
                  }}
                  style={{
                    minHeight: "88px",
                    borderRadius: "6px",
                    padding: "8px 10px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    cursor: hasTrades ? "pointer" : "default",
                    position: "relative",
                    transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                    userSelect: "none",
                    // Custom Neon Accent Styling
                    background: isProfit
                      ? "radial-gradient(circle at 50% 15%, rgba(124, 77, 255, 0.18) 0%, #110D24 100%)"
                      : isLoss
                      ? "radial-gradient(circle at 50% 15%, rgba(255, 79, 154, 0.18) 0%, #1A0F1D 100%)"
                      : isEven
                      ? "radial-gradient(circle at 50% 15%, rgba(255, 194, 75, 0.12) 0%, #141026 100%)"
                      : "#0E0B1A",
                    border: isProfit
                      ? "1px solid #7C4DFF"
                      : isLoss
                      ? "1px solid #FF4F9A"
                      : isEven
                      ? "1px solid #FFC24B"
                      : isCurrentDay
                      ? "1px solid #35F2D066"
                      : "1px solid #1F1932",
                    boxShadow: isProfit
                      ? "0 0 16px rgba(124, 77, 255, 0.32)"
                      : isLoss
                      ? "0 0 16px rgba(255, 79, 154, 0.32)"
                      : isEven
                      ? "0 0 10px rgba(255, 194, 75, 0.25)"
                      : "none"
                  }}
                  onMouseEnter={(e) => {
                    if (hasTrades) {
                      e.currentTarget.style.transform = "translateY(-2px)";
                      if (isProfit) e.currentTarget.style.boxShadow = "0 0 22px rgba(124, 77, 255, 0.55)";
                      else if (isLoss) e.currentTarget.style.boxShadow = "0 0 22px rgba(255, 79, 154, 0.55)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (hasTrades) {
                      e.currentTarget.style.transform = "none";
                      if (isProfit) e.currentTarget.style.boxShadow = "0 0 16px rgba(124, 77, 255, 0.32)";
                      else if (isLoss) e.currentTarget.style.boxShadow = "0 0 16px rgba(255, 79, 154, 0.32)";
                    }
                  }}
                >
                  {/* Top row in day cell: Day number & current day dot */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span
                      style={{
                        font: "600 13px Inter, sans-serif",
                        color: hasTrades ? "#FFFFFF" : "#5E5675"
                      }}
                    >
                      {day.dayNum}
                    </span>

                    {isCurrentDay && (
                      <span
                        style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: "#35F2D0",
                          boxShadow: "0 0 6px #35F2D0"
                        }}
                        title="Сьогодні"
                      />
                    )}
                  </div>

                  {/* Middle / Bottom: PnL and trade count if active */}
                  {hasTrades ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginTop: "4px" }}>
                      <div
                        style={{
                          font: "700 13px JetBrains Mono, monospace",
                          color: isProfit ? "#B9A2FF" : isLoss ? "#FF4F9A" : "#FFC24B",
                          lineHeight: 1.2
                        }}
                      >
                        {day.netPnl >= 0 ? "+" : ""}{day.netPnl.toFixed(2)}$
                      </div>

                      <div
                        style={{
                          fontSize: "10px",
                          color: "#A59CC4",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "4px"
                        }}
                      >
                        <span>{day.trades.length} {day.trades.length === 1 ? "угода" : "угод"}</span>
                        <span>{day.wins}W/{day.losses}L</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ height: "16px" }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "24px",
          flexWrap: "wrap",
          fontSize: "12px",
          color: "#A59CC4",
          padding: "4px 0"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              width: "14px",
              height: "14px",
              borderRadius: "3px",
              background: "#110D24",
              border: "1px solid #7C4DFF",
              boxShadow: "0 0 8px rgba(124, 77, 255, 0.4)"
            }}
          />
          <span>Прибутковий день (фірмовий акцентний неон)</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              width: "14px",
              height: "14px",
              borderRadius: "3px",
              background: "#1A0F1D",
              border: "1px solid #FF4F9A",
              boxShadow: "0 0 8px rgba(255, 79, 154, 0.4)"
            }}
          />
          <span>Збитковий день (рожевий неон)</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              width: "14px",
              height: "14px",
              borderRadius: "3px",
              background: "#0E0B1A",
              border: "1px solid #1F1932"
            }}
          />
          <span>Без угод</span>
        </div>
      </div>

      {/* Modal for Selected Day Trades */}
      {selectedDate && (
        <DayTradesModal
          dateStr={selectedDate}
          trades={selectedDayTrades}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}
