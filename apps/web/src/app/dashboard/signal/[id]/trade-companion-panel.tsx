"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import type { TradeAiSessionData, TradeAiMessageItem } from "./ai-companion-actions";
import {
  sendTradeAiMessage,
  ensureTradeAiSession,
  getLatestTradeAiMessages
} from "./ai-companion-actions";

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
}

export function TradeCompanionPanel({
  initialSession,
  symbol,
  side,
  currentPrice,
  entryPrice,
  stopLossPrice,
  tp1Price,
  pnlUsdt,
  pnlPct,
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

  // Keep session in sync if parent updates initialSession
  useEffect(() => {
    if (initialSession && !session) {
      setSession(initialSession);
      setMessages(initialSession.messages ?? []);
    }
  }, [initialSession, session]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Realtime background sync: poll every 4s for newly pushed messages (e.g. from worker dispatchTradeAiEvent)
  useEffect(() => {
    if (!session?.id) return;
    const interval = setInterval(() => {
      void (async () => {
        try {
          const latest = await getLatestTradeAiMessages(session.id);
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
    }, 4000);

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

      // On-demand session creation upon user interaction (Zero mutations on initial page load)
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

      const res = await sendTradeAiMessage(activeSession.id, prompt, {
        symbol,
        currentPrice,
        side,
        entryPrice,
        stopLoss: stopLossPrice,
        tp1: tp1Price,
        pnlUsdt,
        pnlPct
      });

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
    { label: "📊 Сценарій закриття", prompt: "Чи варто зараз закрити 50% або вийти в безубиток?" },
    { label: "🌊 Дельта та кити", prompt: "Чи є тиск великих ордерів у CVD стакані?" }
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: "520px",
        background: "linear-gradient(180deg, #0F0B1E 0%, #07050F 100%)",
        border: "1px solid #2A2145",
        borderRadius: "8px",
        overflow: "hidden"
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 14px",
          background: "#130E26",
          borderBottom: "1px solid #2A2145",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "6px",
              background: "linear-gradient(135deg, #7C4DFF 0%, #B24BFF 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px"
            }}
          >
            🤖
          </div>
          <div>
            <div style={{ font: "700 13px 'Plus Jakarta Sans', sans-serif", color: "#F1EEFF" }}>
              AI Trade Companion
            </div>
            <div style={{ font: "500 10.5px 'JetBrains Mono', monospace", color: "#8A82A5" }}>
              {symbol} · {side.toUpperCase()} @ ${entryPrice}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              background: "#35F2D0",
              boxShadow: "0 0 8px #35F2D0"
            }}
          />
          <span
            style={{
              font: "700 10px 'JetBrains Mono', monospace",
              color: "#35F2D0",
              textTransform: "uppercase"
            }}
          >
            24/7 Live
          </span>
          {isPaperTrading && (
            <span
              style={{
                background: "rgba(185, 162, 255, 0.15)",
                color: "#B9A2FF",
                border: "1px solid #7C4DFF44",
                padding: "2px 6px",
                borderRadius: "3px",
                fontSize: "10px",
                fontWeight: 600
              }}
            >
              Paper
            </span>
          )}
        </div>
      </div>

      {/* Trade Thesis Banner */}
      <div
        style={{
          padding: "8px 12px",
          background: "rgba(124, 77, 255, 0.08)",
          borderBottom: "1px solid #2A214544",
          fontSize: "11px",
          color: "#A59CC4",
          lineHeight: "1.4"
        }}
      >
        <span style={{ color: "#F1EEFF", fontWeight: 600 }}>Торгова теза: </span>
        {session?.initialThesis ??
          `Вхід у ${side.toUpperCase()} з ціллю TP1 $${tp1Price} та Stop Loss $${stopLossPrice}.`}
      </div>

      {/* Messages Stream */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          fontSize: "12.5px"
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              margin: "auto",
              textAlign: "center",
              color: "#8A82A5",
              padding: "20px"
            }}
          >
            <div style={{ fontSize: "24px", marginBottom: "8px" }}>💬</div>
            <div style={{ fontWeight: 600, color: "#F1EEFF", marginBottom: "4px" }}>
              AI Companion готовий до діалогу
            </div>
            <div style={{ fontSize: "11.5px" }}>
              Запитайте про ризик позиції, структуру або натисніть швидку підказку нижче.
            </div>
          </div>
        ) : (
          messages.map((m) => {
            const isUser = m.authorKind === "user";
            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignSelf: isUser ? "flex-end" : "flex-start",
                  maxWidth: "92%"
                }}
              >
                {!isUser && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      marginBottom: "3px",
                      fontSize: "10px",
                      color: "#7C4DFF",
                      fontWeight: 700
                    }}
                  >
                    <span>{m.agentId === "lead_trade_agent" ? "🤖 Lead Agent" : "⚡ AI Companion"}</span>
                    <span style={{ color: "#6C628A", fontWeight: 400 }}>
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                )}

                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: isUser ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
                    background: isUser
                      ? "linear-gradient(135deg, #7C4DFF 0%, #5B2FCC 100%)"
                      : "#171229",
                    border: isUser ? "1px solid #9C72FF" : "1px solid #2A2145",
                    color: "#F1EEFF",
                    lineHeight: "1.45",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word"
                  }}
                >
                  {m.content}
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
              gap: "6px",
              padding: "6px 12px",
              background: "#171229",
              border: "1px solid #2A2145",
              borderRadius: "8px",
              color: "#8A82A5",
              fontSize: "11px"
            }}
          >
            <span style={{ animation: "pulse 1s infinite" }}>⏳ Lead Agent аналізує ринок...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Action Suggestion Pills */}
      <div
        style={{
          padding: "6px 10px",
          display: "flex",
          gap: "6px",
          overflowX: "auto",
          background: "#0D0A1A",
          borderTop: "1px solid #2A214544"
        }}
      >
        {quickPills.map((p, i) => (
          <button
            key={i}
            onClick={() => handleSend(p.prompt)}
            disabled={isPending}
            style={{
              whiteSpace: "nowrap",
              padding: "4px 8px",
              borderRadius: "4px",
              background: "rgba(124, 77, 255, 0.12)",
              border: "1px solid #7C4DFF33",
              color: "#B9A2FF",
              fontSize: "10.5px",
              fontWeight: 600,
              cursor: isPending ? "not-allowed" : "pointer",
              transition: "all 0.15s"
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Input bar */}
      <div
        style={{
          padding: "10px",
          background: "#130E26",
          borderTop: "1px solid #2A2145",
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
            padding: "8px 12px",
            background: "#0A0714",
            border: "1px solid #2A2145",
            borderRadius: "6px",
            color: "#F1EEFF",
            fontSize: "12px",
            outline: "none"
          }}
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || isPending}
          style={{
            padding: "8px 14px",
            background: input.trim() && !isPending
              ? "linear-gradient(135deg, #7C4DFF 0%, #B24BFF 100%)"
              : "#2A2145",
            border: "none",
            borderRadius: "6px",
            color: input.trim() && !isPending ? "#FFFFFF" : "#6C628A",
            fontSize: "12px",
            fontWeight: 700,
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
