"use client";

import React, { useState, useRef, useEffect, useTransition } from "react";
import type { TradeAiSessionData, TradeAiMessageItem } from "./ai-companion-actions";
import {
  sendTradeAiMessage,
  ensureTradeAiSession,
  getLatestTradeAiMessages
} from "./ai-companion-actions";
import type { Kline } from "@crypto-bot/shared";

interface TradeCompanionPanelProps {
  initialSession: TradeAiSessionData | null;
  symbol: string;
  side: "long" | "short";
  currentPrice: number;
  entryPrice: number;
  stopLossPrice: number;
  tp1Price: number;
  pnlUsdt?: number | undefined;
  pnlPct?: number | undefined;
  isPaperTrading?: boolean | undefined;
  signalId?: string | null | undefined;
  tradeId?: string | null | undefined;
  klines?: Kline[] | undefined;
}

/**
 * Clean Anthropic/Claude-inspired Markdown typesetter.
 * Renders prose, bullet points, headers, monospace numbers and prices
 * without neon SaaS cards or visual noise.
 */
function ClaudeMarkdownContent({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      {lines.map((rawLine, idx) => {
        const line = rawLine.trim();

        // Empty line -> breathing room spacer
        if (!line) {
          return <div key={idx} style={{ height: "6px" }} />;
        }

        // Section header: starts with ### or ## or **Header:**
        const isHeader =
          line.startsWith("### ") ||
          line.startsWith("## ") ||
          (line.startsWith("**") && (line.endsWith(":**") || line.endsWith("**")) && !line.includes("•"));

        if (isHeader) {
          const headerText = line
            .replace(/^#{2,3}\s*/, "")
            .replace(/^\*\*/, "")
            .replace(/\*\*$/, "")
            .replace(/:$/, "");

          return (
            <div
              key={idx}
              style={{
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                fontWeight: 600,
                fontSize: "13.5px",
                color: "#F1EEFF",
                marginTop: idx > 0 ? "8px" : "0",
                marginBottom: "2px",
                letterSpacing: "-0.01em"
              }}
            >
              {headerText}
            </div>
          );
        }

        // Bullet point: starts with • or - or *
        const isBullet = line.startsWith("• ") || line.startsWith("- ") || line.startsWith("* ");
        if (isBullet) {
          const bulletContent = line.replace(/^[•\-*]\s*/, "");
          return (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                paddingLeft: "4px",
                lineHeight: "1.6"
              }}
            >
              <span
                style={{
                  color: "#7C4DFF",
                  userSelect: "none",
                  fontSize: "13px",
                  lineHeight: "1.6"
                }}
              >
                •
              </span>
              <div style={{ flex: 1 }}>{renderInlineTokens(bulletContent)}</div>
            </div>
          );
        }

        // Regular line of prose
        return (
          <div key={idx} style={{ lineHeight: "1.6" }}>
            {renderInlineTokens(line)}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Formats inline bold (**text**), code (`code`), prices ($XX.XX), and PnL markers.
 */
function renderInlineTokens(line: string): React.ReactNode {
  // Regex to match **bold** or `code` tokens
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const parts = line.split(tokenRegex);

  return parts.map((part, i) => {
    if (!part) return null;

    if (part.startsWith("**") && part.endsWith("**")) {
      const inner = part.slice(2, -2);
      return (
        <strong
          key={i}
          style={{
            fontWeight: 600,
            color: "#F1EEFF"
          }}
        >
          {inner}
        </strong>
      );
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      const inner = part.slice(1, -1);
      return (
        <code
          key={i}
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "12px",
            background: "#161324",
            padding: "1px 5px",
            borderRadius: "4px",
            color: "#E2DCF7",
            border: "1px solid rgba(255, 255, 255, 0.08)"
          }}
        >
          {inner}
        </code>
      );
    }

    return <span key={i}>{part}</span>;
  });
}

function formatMsgTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function TradeCompanionPanel({
  initialSession,
  symbol,
  side,
  entryPrice,
  stopLossPrice,
  tp1Price,
  isPaperTrading,
  signalId,
  tradeId
}: TradeCompanionPanelProps) {
  const [session, setSession] = useState<TradeAiSessionData | null>(initialSession);
  const [messages, setMessages] = useState<TradeAiMessageItem[]>(
    initialSession?.messages ?? []
  );
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sync session if parent updates initialSession
  useEffect(() => {
    if (initialSession && !session) {
      setSession(initialSession);
      setMessages(initialSession.messages ?? []);
    }
  }, [initialSession, session]);

  // Guaranteed proactive AI session initialization on mount
  useEffect(() => {
    if (!session && symbol) {
      let isCancelled = false;
      void (async () => {
        try {
          const ensured = await ensureTradeAiSession({
            symbol,
            tradeId: tradeId ?? undefined,
            signalId: signalId ?? undefined,
            side,
            entryPrice,
            stopLoss: stopLossPrice,
            tp1: tp1Price
          });
          if (!isCancelled && ensured) {
            setSession(ensured);
            if (ensured.messages && ensured.messages.length > 0) {
              setMessages(ensured.messages);
            }
          }
        } catch {
          // graceful background init fallback
        }
      })();

      return () => {
        isCancelled = true;
      };
    }
  }, [session, symbol, tradeId, signalId, side, entryPrice, stopLossPrice, tp1Price]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isPending]);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Realtime background sync: poll every 3.5s with cursor delta (Bugfix P1.8)
  useEffect(() => {
    if (!session?.id) return;
    const interval = setInterval(() => {
      void (async () => {
        try {
          const currentMsgs = messagesRef.current;
          const lastMsg = currentMsgs[currentMsgs.length - 1];
          const latest = await getLatestTradeAiMessages(session.id, {
            sinceIso: lastMsg?.createdAt
          });
          if (latest && latest.length > 0) {
            setMessages((prev) => {
              const existingIds = new Set(prev.map((m) => m.id));
              const newOnes = latest.filter((m) => !existingIds.has(m.id));
              if (newOnes.length === 0) return prev;
              return [...prev, ...newOnes];
            });
          }
        } catch {
          // silent background sync catch
        }
      })();
    }, 3500);

    return () => clearInterval(interval);
  }, [session?.id]);

  const handleSend = (textToSend?: string) => {
    const prompt = (textToSend ?? input).trim();
    if (!prompt || isPending) return;

    if (!textToSend) setInput("");

    const optimisticUserMsg: TradeAiMessageItem = {
      id: `temp-${Date.now()}`,
      authorKind: "user",
      kind: "text",
      content: prompt,
      createdAt: new Date().toISOString()
    };

    setMessages((prev) => [...prev, optimisticUserMsg]);

    startTransition(async () => {
      let activeSession = session;

      if (!activeSession) {
        activeSession = await ensureTradeAiSession({
          symbol,
          tradeId: tradeId ?? undefined,
          signalId: signalId ?? undefined,
          side,
          entryPrice,
          stopLoss: stopLossPrice,
          tp1: tp1Price
        });
        if (activeSession) {
          setSession(activeSession);
          if (activeSession.messages && activeSession.messages.length > 0) {
            setMessages((prev) => {
              const prevWithoutTemp = prev.filter((m) => m.id !== optimisticUserMsg.id);
              return [...activeSession!.messages, ...prevWithoutTemp, optimisticUserMsg];
            });
          }
        }
      }

      if (!activeSession?.id) return;

      const res = await sendTradeAiMessage(activeSession.id, prompt);

      if (res) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.id)) return prev;
          return [...prev, res];
        });
      }
    });
  };

  const quickPills = [
    { label: "📐 Структура тренду", prompt: "Яка поточна структура тренду на 15M/1H?" },
    { label: "🛡️ Оцінка ризику", prompt: "Який поточний рівень ризику для мого стопу?" },
    { label: "🌊 Потік CVD та дельта", prompt: "Чи є тиск великих ордерів у CVD стакані?" },
    { label: "📊 Сценарій закриття", prompt: "Чи варто зараз закрити 50% або вийти в безубиток?" }
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        minHeight: "520px",
        background: "#0C0A14",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "10px",
        overflow: "hidden"
      }}
    >
      {/* Header: Clean, quiet, Claude-inspired restraint */}
      <div
        style={{
          padding: "12px 16px",
          background: "#100D1C",
          borderBottom: "1px solid rgba(255, 255, 255, 0.07)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div>
            <div style={{ font: "600 13.5px 'Plus Jakarta Sans', sans-serif", color: "#F1EEFF" }}>
              Vexqora AI
            </div>
            <div style={{ font: "500 11px 'JetBrains Mono', monospace", color: "#8A82A5" }}>
              {symbol} · {side.toUpperCase()} @ ${entryPrice}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "#35F2D0"
            }}
          />
          <span
            style={{
              font: "500 11px 'JetBrains Mono', monospace",
              color: "#8A82A5"
            }}
          >
            Онлайн
          </span>
          {isPaperTrading && (
            <span
              style={{
                background: "#161324",
                color: "#A59CC4",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                padding: "2px 7px",
                borderRadius: "4px",
                fontSize: "10.5px",
                fontWeight: 600
              }}
            >
              Paper
            </span>
          )}
        </div>
      </div>

      {/* Messages Stream: Generous breathing room, unboxed AI document prose */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "18px 16px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          fontSize: "13px"
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              margin: "auto",
              textAlign: "center",
              color: "#8A82A5",
              padding: "24px",
              maxWidth: "320px"
            }}
          >
            <div style={{ fontWeight: 600, color: "#F1EEFF", marginBottom: "6px", fontSize: "14px" }}>
              AI Companion готовий до діалогу
            </div>
            <div style={{ fontSize: "12px", lineHeight: "1.5" }}>
              Поставте запитання про поточну ринкову структуру, дистанцію до стоп-лосу або скористайтеся підказками нижче.
            </div>
          </div>
        ) : (
          messages.map((m) => {
            const isUser = m.authorKind === "user";

            if (isUser) {
              return (
                <div
                  key={m.id}
                  style={{
                    alignSelf: "flex-end",
                    maxWidth: "85%",
                    padding: "9px 13px",
                    borderRadius: "12px 12px 3px 12px",
                    background: "#181424",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    color: "#F1EEFF",
                    lineHeight: "1.5",
                    fontSize: "13px",
                    wordBreak: "break-word"
                  }}
                >
                  {m.content}
                </div>
              );
            }

            // AI or Background Event Message: Editorial document layout
            const isSystemEvent = m.authorKind === "system" || m.kind === "event";

            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignSelf: "flex-start",
                  width: "100%",
                  gap: "4px"
                }}
              >
                {/* Meta header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "11px",
                    color: "#80779E"
                  }}
                >
                  <span style={{ fontWeight: 600, color: isSystemEvent ? "#FFC24B" : "#B5AEC7" }}>
                    {isSystemEvent ? "Подія ринку" : "Vexqora AI"}
                  </span>
                  <span>·</span>
                  <span>{formatMsgTime(m.createdAt)}</span>
                  {m.structuredPayload?.source === "openrouter_llm" ? (
                    <span
                      style={{
                        marginLeft: "4px",
                        fontSize: "10px",
                        fontFamily: "'JetBrains Mono', monospace",
                        color: "#B285FF",
                        background: "rgba(124, 77, 255, 0.12)",
                        border: "1px solid rgba(124, 77, 255, 0.28)",
                        borderRadius: "3px",
                        padding: "1px 5px"
                      }}
                    >
                      OpenRouter LLM {typeof m.structuredPayload?.tokensUsed === "number" ? `· ${m.structuredPayload.tokensUsed} tok` : ""}
                    </span>
                  ) : m.structuredPayload?.source === "deterministic_fallback" ? (
                    <span
                      style={{
                        marginLeft: "4px",
                        fontSize: "10px",
                        fontFamily: "'JetBrains Mono', monospace",
                        color: "#FFC24B",
                        background: "rgba(255, 194, 75, 0.12)",
                        border: "1px solid rgba(255, 194, 75, 0.28)",
                        borderRadius: "3px",
                        padding: "1px 5px"
                      }}
                    >
                      Детерміністичний синтез
                    </span>
                  ) : null}
                </div>

                {/* Editorial text */}
                <div
                  style={{
                    color: "#D8D3E8",
                    lineHeight: "1.65",
                    fontSize: "13px",
                    paddingLeft: "2px"
                  }}
                >
                  <ClaudeMarkdownContent text={m.content} />
                </div>
              </div>
            );
          })
        )}

        {isPending && (
          <div
            style={{
              alignSelf: "flex-start",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "6px 2px",
              color: "#8A82A5",
              fontSize: "12px"
            }}
          >
            <span>Аналізую ринок</span>
            <span
              style={{
                display: "inline-flex",
                gap: "2px",
                fontSize: "14px",
                letterSpacing: "1px"
              }}
            >
              ···
            </span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Action Suggestion Pills (Shown only in fresh/empty conversations) */}
      {messages.length <= 2 && (
        <div
          style={{
            padding: "8px 14px",
            display: "flex",
            gap: "6px",
            overflowX: "auto",
            background: "#0E0B1A",
            borderTop: "1px solid rgba(255, 255, 255, 0.05)"
          }}
        >
          {quickPills.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSend(p.prompt)}
              disabled={isPending}
              style={{
                whiteSpace: "nowrap",
                padding: "4px 9px",
                borderRadius: "5px",
                background: "#151222",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                color: "#A59CC4",
                fontSize: "11px",
                fontWeight: 500,
                cursor: isPending ? "not-allowed" : "pointer",
                transition: "all 0.15s"
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Input Composer: Pinned at bottom */}
      <div
        style={{
          padding: "10px 14px",
          background: "#100D1C",
          borderTop: "1px solid rgba(255, 255, 255, 0.07)",
          display: "flex",
          gap: "8px",
          alignItems: "center"
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={`Запитайте AI про ${symbol}...`}
          disabled={isPending}
          style={{
            flex: 1,
            padding: "9px 12px",
            background: "#141120",
            border: "1px solid rgba(255, 255, 255, 0.09)",
            borderRadius: "6px",
            color: "#F1EEFF",
            fontSize: "12.5px",
            outline: "none"
          }}
        />
        <button
          type="button"
          onClick={() => handleSend()}
          disabled={!input.trim() || isPending}
          style={{
            padding: "8px 14px",
            background: input.trim() && !isPending ? "#7C4DFF" : "#1F1A2E",
            border: "none",
            borderRadius: "6px",
            color: input.trim() && !isPending ? "#FFFFFF" : "#5F5774",
            fontSize: "12px",
            fontWeight: 600,
            cursor: input.trim() && !isPending ? "pointer" : "not-allowed",
            transition: "all 0.15s"
          }}
        >
          Надіслати
        </button>
      </div>
    </div>
  );
}
