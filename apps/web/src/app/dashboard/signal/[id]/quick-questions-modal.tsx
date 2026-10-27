"use client";

import { useState, useEffect, useRef } from "react";

export interface QuickQuestionItem {
  id: string;
  category: "structure" | "risk" | "orderflow" | "take_profit";
  categoryLabel: string;
  categoryIcon: string;
  title: string;
  prompt: string;
  badge?: string;
}

export const PRESET_TRADE_QUESTIONS: QuickQuestionItem[] = [
  // 1. Structure & Levels (4)
  {
    id: "q1",
    category: "structure",
    categoryLabel: "Ринкова структура",
    categoryIcon: "📐",
    title: "Структура тренду 15M / 1H / 4H",
    prompt: "Яка поточна структура тренду на 15M/1H/4H? Чи є узгодженість між таймфреймами?",
    badge: "15M/4H"
  },
  {
    id: "q2",
    category: "structure",
    categoryLabel: "Ринкова структура",
    categoryIcon: "📐",
    title: "Ознаки зламу BOS / CHOCH",
    prompt: "Чи є на поточному русі ознаки структурного зламу (BOS/CHOCH) або зняття ліквідності (Sweep)?"
  },
  {
    id: "q3",
    category: "structure",
    categoryLabel: "Ринкова структура",
    categoryIcon: "📐",
    title: "Зони дисбалансу FVG та Order Blocks",
    prompt: "Де знаходяться найближчі неперекриті дисбаланси (Fair Value Gaps) та Order Blocks для поточної позиції?"
  },
  {
    id: "q4",
    category: "structure",
    categoryLabel: "Ринкова структура",
    categoryIcon: "📐",
    title: "Критичний рівень інвалідації",
    prompt: "Де розташований точний рівень інвалідації торгового сетапу, після якого сценарій втрачає чинність?"
  },

  // 2. Risk Management & Stop Loss (4)
  {
    id: "q5",
    category: "risk",
    categoryLabel: "Ризик & Stop Loss",
    categoryIcon: "🛡️",
    title: "Оцінка дистанції до Stop Loss",
    prompt: "Який поточний рівень ризику для мого захисного Stop Loss з урахуванням локального шуму?"
  },
  {
    id: "q6",
    category: "risk",
    categoryLabel: "Ризик & Stop Loss",
    categoryIcon: "🛡️",
    title: "Перенесення стопу в Breakeven (беззбиток)",
    prompt: "Чи варто зараз перенести Stop Loss на рівень ціни входу (Breakeven) для повного зняття ризику?",
    badge: "0-Risk"
  },
  {
    id: "q7",
    category: "risk",
    categoryLabel: "Ризик & Stop Loss",
    categoryIcon: "🛡️",
    title: "Динамічний Trailing Stop",
    prompt: "Як налаштувати динамічний Trailing Stop за локальними екстремумами, щоб захистити накопичений прибуток?"
  },
  {
    id: "q8",
    category: "risk",
    categoryLabel: "Ризик & Stop Loss",
    categoryIcon: "🛡️",
    title: "Ймовірність вибиття за ATR волатильністю",
    prompt: "Яка ймовірність хибного вибиття стопу через сплеск волатильності ATR(14) на ринку?"
  },

  // 3. Order Flow & CVD Depth (3)
  {
    id: "q9",
    category: "orderflow",
    categoryLabel: "Order Flow & Стакан",
    categoryIcon: "🌊",
    title: "Тиск ліквідності у стакані Bybit",
    prompt: "Чи є тиск великих лімітних стінок або агресивних ринкових ордерів у біржовому стакані Bybit?"
  },
  {
    id: "q10",
    category: "orderflow",
    categoryLabel: "Order Flow & Стакан",
    categoryIcon: "🌊",
    title: "Кумулятивна дельта (CVD) та OBI",
    prompt: "Який поточний стан дельти CVD та біржового дисбалансу книги замовлень (Order Book Imbalance)?"
  },
  {
    id: "q11",
    category: "orderflow",
    categoryLabel: "Order Flow & Стакан",
    categoryIcon: "🌊",
    title: "Ознаки пасивної абсорбції",
    prompt: "Чи спостерігаються ознаки прихованої пасивної абсорбції лімітними покупцями чи продавцями?"
  },

  // 4. Take Profit & Exits (4)
  {
    id: "q12",
    category: "take_profit",
    categoryLabel: "Тейк-профіт & Вихід",
    categoryIcon: "🎯",
    title: "Фіксація 50% об'єму позиції",
    prompt: "Чи варто зараз закрити 50% об'єму для гарантованої фіксації профіту на поточному імпульсі?",
    badge: "50% Lock"
  },
  {
    id: "q13",
    category: "take_profit",
    categoryLabel: "Тейк-профіт & Вихід",
    categoryIcon: "🎯",
    title: "Ймовірність досягнення TP1",
    prompt: "Яка ймовірність та динаміка досягнення першої цілі TP1 з поточної цінової консолідації?"
  },
  {
    id: "q14",
    category: "take_profit",
    categoryLabel: "Тейк-профіт & Вихід",
    categoryIcon: "🎯",
    title: "Каскадний розподіл TP1 / TP2 / TP3",
    prompt: "Як оптимально розподілити часткові виходи між TP1 (40%), TP2 (30%) та TP3 (30%)?"
  },
  {
    id: "q15",
    category: "take_profit",
    categoryLabel: "Тейк-профіт & Вихід",
    categoryIcon: "🎯",
    title: "Підсумковий вердикт Lead Agent",
    prompt: "Який підсумковий вердикт та синтез ансамблю агентів для подальшого супроводу цієї позиції?",
    badge: "Lead Verdict"
  }
];

interface QuickQuestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectQuestion: (prompt: string) => void;
  disabled?: boolean;
}

export function QuickQuestionsModal({
  isOpen,
  onClose,
  onSelectQuestion,
  disabled = false
}: QuickQuestionsModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const categories = [
    { key: "all", label: "Всі (15)", icon: "✨" },
    { key: "structure", label: "Структура", icon: "📐" },
    { key: "risk", label: "Ризик & SL", icon: "🛡️" },
    { key: "orderflow", label: "Order Flow", icon: "🌊" },
    { key: "take_profit", label: "Тейк & Вихід", icon: "🎯" }
  ];

  const filteredQuestions = PRESET_TRADE_QUESTIONS.filter((q) => {
    const matchesCat = selectedCategory === "all" || q.category === selectedCategory;
    const matchesSearch =
      searchQuery.trim() === "" ||
      q.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.prompt.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        background: "rgba(5, 3, 12, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        animation: "fadeOverlay 0.15s ease-out"
      }}
    >
      <div
        ref={containerRef}
        style={{
          background: "#0D0B18",
          borderTop: "1px solid #2A2145",
          borderRadius: "14px 14px 0 0",
          boxShadow: "0 -8px 32px rgba(0, 0, 0, 0.6)",
          maxHeight: "80%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "15px" }}>⚡</span>
            <div>
              <div style={{ font: "600 13px 'Plus Jakarta Sans', sans-serif", color: "#F1EEFF" }}>
                Готові запитання до AI Companion
              </div>
              <div style={{ font: "400 11px 'JetBrains Mono', monospace", color: "#8A82A5" }}>
                Оберіть аналітичний сценарій в один клік
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: "#161226",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "6px",
              color: "#A59CC4",
              width: "26px",
              height: "26px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontSize: "13px"
            }}
          >
            ✕
          </button>
        </div>

        {/* Search Bar & Category Filter Pills */}
        <div
          style={{
            padding: "10px 14px",
            background: "#100D1F",
            borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}
        >
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Швидкий пошук (наприклад: стоп, 50%, cvd, інвалідація)..."
            style={{
              width: "100%",
              padding: "7px 10px",
              background: "#161328",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "6px",
              color: "#F1EEFF",
              fontSize: "12px",
              outline: "none",
              fontFamily: "inherit"
            }}
          />

          <div
            style={{
              display: "flex",
              gap: "6px",
              overflowX: "auto",
              paddingBottom: "2px"
            }}
            className="companion-chat-scroll"
          >
            {categories.map((c) => {
              const active = selectedCategory === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setSelectedCategory(c.key)}
                  style={{
                    whiteSpace: "nowrap",
                    padding: "3px 8px",
                    borderRadius: "5px",
                    background: active ? "rgba(124, 77, 255, 0.2)" : "#141122",
                    border: `1px solid ${active ? "#7C4DFF" : "rgba(255, 255, 255, 0.07)"}`,
                    color: active ? "#35F2D0" : "#A59CC4",
                    fontSize: "11px",
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px"
                  }}
                >
                  <span>{c.icon}</span>
                  <span>{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Questions List */}
        <div
          className="companion-chat-scroll"
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px 12px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            maxHeight: "360px"
          }}
        >
          {filteredQuestions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: "#8A82A5", fontSize: "12px" }}>
              За запитом «{searchQuery}» запитань не знайдено
            </div>
          ) : (
            filteredQuestions.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  if (disabled) return;
                  onSelectQuestion(item.prompt);
                  onClose();
                }}
                style={{
                  padding: "9px 12px",
                  borderRadius: "8px",
                  background: "#131024",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  cursor: disabled ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "10px",
                  transition: "all 0.15s ease"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#1B1633";
                  e.currentTarget.style.borderColor = "rgba(124, 77, 255, 0.4)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#131024";
                  e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.06)";
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                  <span style={{ fontSize: "14px", marginTop: "1px" }}>{item.categoryIcon}</span>
                  <div>
                    <div
                      style={{
                        font: "600 12.5px 'Plus Jakarta Sans', sans-serif",
                        color: "#F1EEFF",
                        lineHeight: "1.4"
                      }}
                    >
                      {item.title}
                    </div>
                    <div
                      style={{
                        font: "400 11px 'Plus Jakarta Sans', sans-serif",
                        color: "#8A82A5",
                        marginTop: "2px",
                        lineHeight: "1.35"
                      }}
                    >
                      {item.prompt}
                    </div>
                  </div>
                </div>

                {item.badge && (
                  <span
                    style={{
                      font: "600 9.5px 'JetBrains Mono', monospace",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      background: "rgba(53, 242, 208, 0.1)",
                      color: "#35F2D0",
                      border: "1px solid rgba(53, 242, 208, 0.25)",
                      whiteSpace: "nowrap",
                      flexShrink: 0
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
