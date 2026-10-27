"use client";

import React, { useState, useRef, useEffect, useTransition, useCallback } from "react";
import type { TradeAiSessionData, TradeAiMessageItem } from "./ai-companion-actions";
import {
  sendTradeAiMessage,
  ensureTradeAiSession,
  getLatestTradeAiMessages
} from "./ai-companion-actions";
import type { Kline } from "@crypto-bot/shared";
import { PixelDroneMascot, usePixelDroneMachine } from "../../../../components/pixel-drone-mascot";
import { QuickQuestionsModal } from "./quick-questions-modal";

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

interface LiveProgressStep {
  runId: string;
  stage: "queued" | "fetching_data" | "analyzing" | "synthesizing";
  stepKey: string;
  label: string;
  status: "active" | "completed" | "insufficient_data" | "failed";
  details?: string;
}

interface ActiveRunState {
  runId: string;
  steps: LiveProgressStep[];
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
  const [activeRun, setActiveRun] = useState<ActiveRunState | null>(null);

  // P0.1: Internal container scroll ref — NEVER call scrollIntoView which affects window.scrollY
  const chatScrollContainerRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUp = useRef(false);
  const [showScrollBottomPill, setShowScrollBottomPill] = useState(false);
  const prevMessagesLengthRef = useRef(messages.length);
  const isSendingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const droneMachine = usePixelDroneMachine();
  const [isQuickQuestionsOpen, setIsQuickQuestionsOpen] = useState(false);

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

  /**
   * P0.1: Manages internal scrollTop only. Never affects window.scrollY.
   * If user has scrolled up to read older messages, do not auto-scroll down to interrupt them.
   */
  const handleContainerScroll = useCallback(() => {
    const el = chatScrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isUp = distanceFromBottom > 30;
    isUserScrolledUp.current = isUp;
    setShowScrollBottomPill(isUp);
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    const el = chatScrollContainerRef.current;
    if (!el) return;
    if (force || !isUserScrolledUp.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      isUserScrolledUp.current = false;
      setShowScrollBottomPill(false);
    }
  }, []);

  // Proactive scroll management: only scroll when new messages arrive and user is not reading history
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current) {
      if (!isUserScrolledUp.current) {
        scrollToBottom(false);
      }
      prevMessagesLengthRef.current = messages.length;
    } else if (messages.length < prevMessagesLengthRef.current) {
      prevMessagesLengthRef.current = messages.length;
    }
  }, [messages.length, scrollToBottom]);

  // Initial scroll to bottom once session messages are loaded on mount
  useEffect(() => {
    if (messages.length > 0 && prevMessagesLengthRef.current === 0) {
      scrollToBottom(true);
    }
  }, [messages.length, scrollToBottom]);

  // Auto-scroll on active run progress updates only if user is at bottom
  useEffect(() => {
    if (activeRun && !isUserScrolledUp.current) {
      scrollToBottom(false);
    }
  }, [activeRun, scrollToBottom]);

  // Auto-scroll to show drone mascot when animation starts
  useEffect(() => {
    if (droneMachine.isAnimating && !isUserScrolledUp.current) {
      scrollToBottom(false);
    }
  }, [droneMachine.isAnimating, droneMachine.phase, scrollToBottom]);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Realtime background sync: poll every 3.5s with cursor delta and optimistic message reconciliation (P0.2 & P1.8)
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
              // 1. Reconcile optimistic messages: replace temp messages whose clientMessageId matches server version
              let updated = prev.map((local) => {
                const match = latest.find(
                  (srv) => (srv.clientMessageId && srv.clientMessageId === local.clientMessageId) || srv.id === local.id
                );
                if (match) {
                  return { ...match, status: "sent" as const };
                }
                return local;
              });

              // 2. Identify brand-new messages
              const existingIds = new Set(updated.map((m) => m.id));
              const existingClientIds = new Set(updated.map((m) => m.clientMessageId).filter(Boolean));

              const trulyNew = latest.filter(
                (m) => !existingIds.has(m.id) && (!m.clientMessageId || !existingClientIds.has(m.clientMessageId))
              );

              if (trulyNew.length > 0) {
                updated = [...updated, ...trulyNew];
              }

              return updated.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            });
          }
        } catch {
          // silent background sync catch
        }
      })();
    }, 3500);

    return () => clearInterval(interval);
  }, [session?.id]);

  /**
   * P0.1, P0.2, P0.3: Handles sending with clientMessageId, SSE live progress streaming,
   * optimistic state reconciliation, and double-submit prevention.
   */
  const handleSend = (textToSend?: string) => {
    const prompt = (textToSend ?? input).trim();
    if (!prompt || isSendingRef.current || isPending) return;

    isSendingRef.current = true;
    if (!textToSend) setInput("");

    // Generate unique client message ID for reconciliation
    const clientMessageId = `cmsg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const optimisticUserMsg: TradeAiMessageItem = {
      id: clientMessageId,
      clientMessageId,
      authorKind: "user",
      kind: "text",
      content: prompt,
      createdAt: new Date().toISOString(),
      status: "sending"
    };

    setMessages((prev) => [...prev, optimisticUserMsg]);
    isUserScrolledUp.current = false;
    setShowScrollBottomPill(false);
    // Force scroll internal container to bottom on user send
    scrollToBottom(true);

    // P0.1 / P0.2 / Drone: Start synchronized Pixel Drone animation cycle with buffered response reveal
    droneMachine.startCycle(clientMessageId, (revealedPayload) => {
      isSendingRef.current = false;
      inputRef.current?.focus();

      if (
        !revealedPayload ||
        (typeof revealedPayload === "object" && "error" in (revealedPayload as Record<string, unknown>))
      ) {
        setMessages((prev) =>
          prev.map((m) => (m.clientMessageId === clientMessageId ? { ...m, status: "failed" } : m))
        );
        return;
      }

      const completedMsg = revealedPayload as TradeAiMessageItem;
      setMessages((prev) => {
        const reconciled = prev.map((m) =>
          m.clientMessageId === clientMessageId ? { ...m, status: "sent" as const } : m
        );
        if (reconciled.some((m) => m.id === completedMsg.id)) return reconciled;
        return [...reconciled, completedMsg];
      });
      scrollToBottom(true);
    });

    startTransition(async () => {
      let activeSession = session;

      if (!activeSession) {
        try {
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
        } catch {
          // session ensure error
        }
      }

      if (!activeSession?.id) {
        droneMachine.finishResponse({ error: true });
        return;
      }

      const sessionIdToUse = activeSession.id;

      // P0.3: Try live streaming execution stages endpoint first
      try {
        const response = await fetch("/api/ai/companion/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionIdToUse,
            userPrompt: prompt,
            clientMessageId
          })
        });

        if (response.ok && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const clean = line.replace(/^data:\s*/, "").trim();
              if (!clean) continue;

              try {
                const event = JSON.parse(clean) as Record<string, unknown>;

                if (event.type === "run_started") {
                  setActiveRun({
                    runId: String(event.runId),
                    steps: []
                  });
                } else if (event.type === "step") {
                  const stepObj = event as unknown as LiveProgressStep;
                  setActiveRun((prev) => {
                    const currentSteps = prev?.steps ? [...prev.steps] : [];
                    const existingIdx = currentSteps.findIndex((s) => s.stepKey === stepObj.stepKey);
                    if (existingIdx >= 0) {
                      currentSteps[existingIdx] = stepObj;
                    } else {
                      currentSteps.push(stepObj);
                    }
                    return {
                      runId: stepObj.runId,
                      steps: currentSteps
                    };
                  });
                } else if (event.type === "completed") {
                  const completedMsg = event.message as TradeAiMessageItem;
                  setActiveRun(null);
                  // Buffer response in drone machine; will reveal after exiting animation completes
                  droneMachine.finishResponse(completedMsg);
                } else if (event.type === "failed") {
                  setActiveRun(null);
                  droneMachine.finishResponse({ error: true });
                }
              } catch {
                // stream json parse error
              }
            }
          }

          return;
        }
      } catch {
        // stream request failed, fallback to server action
      }

      // Fallback: direct Server Action
      try {
        const res = await sendTradeAiMessage(sessionIdToUse, prompt, clientMessageId);
        setActiveRun(null);

        if (res) {
          droneMachine.finishResponse(res);
        } else {
          droneMachine.finishResponse({ error: true });
        }
      } catch {
        setActiveRun(null);
        droneMachine.finishResponse({ error: true });
      }
    });
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        maxHeight: "100%",
        minHeight: 0,
        width: "100%",
        background: "#0C0A14",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "10px",
        overflow: "hidden",
        position: "relative"
      }}
    >
      {/* Quick Questions Adaptive Modal */}
      <QuickQuestionsModal
        isOpen={isQuickQuestionsOpen}
        onClose={() => setIsQuickQuestionsOpen(false)}
        onSelectQuestion={(selectedPrompt) => {
          handleSend(selectedPrompt);
        }}
        disabled={isPending || activeRun !== null || droneMachine.isAnimating}
      />

      {/* Header: Clean, quiet, Claude / OpenClaw inspired restraint */}
      <div
        style={{
          padding: "10px 14px",
          background: "#0E0B1A",
          borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <img
            src="/animations/vexqora/vexqora-logo-static.svg"
            alt="Vexqora Pixel Drone"
            style={{ width: "24px", height: "20px", objectFit: "contain", flexShrink: 0 }}
          />
          <div>
            <div
              style={{
                font: "600 13px 'Plus Jakarta Sans', sans-serif",
                color: "#F1EEFF",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <span>Vexqora AI</span>
              <span
                style={{
                  font: "600 9.5px 'JetBrains Mono', monospace",
                  background: "rgba(124, 77, 255, 0.15)",
                  color: "#B9A2FF",
                  padding: "1px 5px",
                  borderRadius: "4px",
                  border: "1px solid rgba(124, 77, 255, 0.25)"
                }}
              >
                Pixel Drone
              </span>
            </div>
            <div style={{ font: "500 10.5px 'JetBrains Mono', monospace", color: "#8A82A5" }}>
              {symbol} · {side.toUpperCase()} @ ${entryPrice}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Quick Questions Trigger in Header */}
          <button
            type="button"
            onClick={() => setIsQuickQuestionsOpen(true)}
            disabled={isPending || activeRun !== null || droneMachine.isAnimating}
            title="Відкрити 15 готових аналітичних сценаріїв"
            style={{
              background: "#161228",
              color: "#35F2D0",
              border: "1px solid rgba(53, 242, 208, 0.3)",
              padding: "3px 9px",
              borderRadius: "5px",
              fontSize: "11px",
              fontWeight: 600,
              cursor: isPending || activeRun !== null || droneMachine.isAnimating ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              transition: "all 0.15s ease"
            }}
          >
            <span>⚡</span>
            <span>Запитання (15)</span>
          </button>

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

      {/* Messages Stream: Internal scroll container only */}
      <div
        ref={chatScrollContainerRef}
        onScroll={handleContainerScroll}
        className="companion-chat-scroll"
        style={{
          flex: "1 1 0%",
          minHeight: 0,
          maxHeight: "100%",
          overflowY: "auto",
          overscrollBehavior: "contain",
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
              const isSending = m.status === "sending";
              const isFailed = m.status === "failed";

              return (
                <div
                  key={m.id}
                  style={{
                    alignSelf: "flex-end",
                    maxWidth: "85%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: "4px"
                  }}
                >
                  <div
                    style={{
                      padding: "9px 13px",
                      borderRadius: "12px 12px 3px 12px",
                      background: isFailed ? "#2A121F" : "#181424",
                      border: isFailed ? "1px solid #FF4F9A" : "1px solid rgba(255, 255, 255, 0.08)",
                      color: "#F1EEFF",
                      lineHeight: "1.5",
                      fontSize: "13px",
                      wordBreak: "break-word",
                      opacity: isSending ? 0.75 : 1
                    }}
                  >
                    {m.content}
                  </div>

                  {isSending && (
                    <span style={{ fontSize: "10.5px", color: "#80779E" }}>
                      Відправлення...
                    </span>
                  )}

                  {isFailed && (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "11px", color: "#FF4F9A" }}>Не вдалося надіслати</span>
                      <button
                        type="button"
                        onClick={() => handleSend(m.content)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#B285FF",
                          fontSize: "11px",
                          cursor: "pointer",
                          textDecoration: "underline"
                        }}
                      >
                        Повторити
                      </button>
                    </div>
                  )}
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

        {/* P0.3: Live Execution Stages (Claude / Codex clean progress journal) */}
        {activeRun && activeRun.steps.length > 0 && (
          <div
            style={{
              alignSelf: "flex-start",
              width: "100%",
              maxWidth: "92%",
              background: "#0E0B1A",
              border: "1px solid rgba(124, 77, 255, 0.25)",
              borderRadius: "8px",
              padding: "10px 14px",
              display: "flex",
              flexDirection: "column",
              gap: "7px",
              fontSize: "12px",
              color: "#A59CC4"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#F1EEFF", fontWeight: 600 }}>
                <span style={{ color: "#7C4DFF" }}>◈</span>
                <span>Аналітичний контур у дії</span>
              </div>
              <span style={{ fontSize: "10px", fontFamily: "'JetBrains Mono', monospace", color: "#80779E" }}>
                {activeRun.runId}
              </span>
            </div>

            {activeRun.steps.map((s, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: "8px", lineHeight: "1.4" }}>
                <span
                  style={{
                    color:
                      s.status === "completed"
                        ? "#35F2D0"
                        : s.status === "insufficient_data"
                        ? "#FFC24B"
                        : s.status === "failed"
                        ? "#FF4F9A"
                        : "#B285FF",
                    fontWeight: 600,
                    width: "12px",
                    userSelect: "none"
                  }}
                >
                  {s.status === "completed" ? "✓" : s.status === "insufficient_data" ? "!" : s.status === "failed" ? "✕" : "⏳"}
                </span>
                <div style={{ flex: 1 }}>
                  <span style={{ color: s.status === "active" ? "#F1EEFF" : "#A59CC4" }}>
                    {s.label}
                  </span>
                  {s.details && (
                    <span
                      style={{
                        marginLeft: "6px",
                        color: "#80779E",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: "11px"
                      }}
                    >
                      ({s.details})
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Vexqora Pixel Drone Mascot State Machine */}
        {droneMachine.isAnimating && (
          <div
            style={{
              alignSelf: "flex-start",
              width: "100%",
              maxWidth: "92%",
              background: "#0D0A18",
              border: "1px solid rgba(124, 77, 255, 0.2)",
              borderRadius: "12px",
              padding: "14px 18px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <PixelDroneMascot
                phase={droneMachine.phase}
                requestId={droneMachine.activeRequestId}
                width={105}
                height={88}
                showStatusText={false}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                <div
                  style={{
                    font: "600 13px 'Plus Jakarta Sans', sans-serif",
                    color: "#F1EEFF",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px"
                  }}
                >
                  <span>Vexqora AI</span>
                  <span
                    style={{
                      font: "600 9.5px 'JetBrains Mono', monospace",
                      color: "#35F2D0",
                      background: "rgba(53, 242, 208, 0.12)",
                      padding: "1px 6px",
                      borderRadius: "4px",
                      border: "1px solid rgba(53, 242, 208, 0.25)"
                    }}
                  >
                    {droneMachine.phase === "entering"
                      ? "Формування дрона"
                      : droneMachine.phase === "thinking"
                      ? "ШІ аналіз"
                      : "Фіналізація"}
                  </span>
                </div>
                <div
                  style={{
                    font: "400 11.5px 'JetBrains Mono', monospace",
                    color: "#A59CC4"
                  }}
                >
                  {droneMachine.phase === "entering" && "Морфінг логотипа у дрон (2.8с)…"}
                  {droneMachine.phase === "thinking" && "Аналіз структури 15M/4H та книги ордерів Bybit…"}
                  {droneMachine.phase === "exiting" && "Повернення дрона у логотип (2.2с)…"}
                </div>
              </div>
            </div>

            {/* Streamed Execution Stages (if any) */}
            {activeRun && activeRun.steps.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "5px",
                  paddingTop: "8px",
                  borderTop: "1px solid rgba(255, 255, 255, 0.05)"
                }}
              >
                {activeRun.steps.map((s, idx) => (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px" }}>
                    <span
                      style={{
                        color: s.status === "completed" ? "#35F2D0" : "#B285FF",
                        fontWeight: 600,
                        width: "12px"
                      }}
                    >
                      {s.status === "completed" ? "✓" : "⚡"}
                    </span>
                    <span style={{ color: s.status === "active" ? "#F1EEFF" : "#A59CC4" }}>{s.label}</span>
                    {s.details && (
                      <span
                        style={{
                          color: "#80779E",
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "10.5px"
                        }}
                      >
                        ({s.details})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Jump to Bottom Pill (Appears when scrolled up to read older messages) */}
      {showScrollBottomPill && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          style={{
            position: "absolute",
            bottom: "85px",
            right: "20px",
            zIndex: 10,
            background: "#1E1838",
            color: "#B28DFF",
            border: "1px solid #7C4DFF66",
            borderRadius: "20px",
            padding: "5px 12px",
            fontSize: "11px",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: "5px",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            transition: "all 0.15s ease"
          }}
        >
          <span>↓</span> До нових повідомлень
        </button>
      )}

      {/* Multiline Composer: Anthropic Claude / OpenClaw Minimalist Styling */}
      <div
        style={{
          padding: "10px 14px",
          background: "#0D0B18",
          borderTop: "1px solid rgba(255, 255, 255, 0.07)",
          display: "flex",
          flexDirection: "column",
          gap: "8px"
        }}
      >
        {/* Helper Toolbar: Single Quick Questions Trigger */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "11px"
          }}
        >
          <button
            type="button"
            onClick={() => setIsQuickQuestionsOpen((v) => !v)}
            disabled={isPending || activeRun !== null || droneMachine.isAnimating}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              padding: "4px 10px",
              background: isQuickQuestionsOpen ? "rgba(124, 77, 255, 0.2)" : "#141024",
              border: `1px solid ${isQuickQuestionsOpen ? "#7C4DFF" : "rgba(124, 77, 255, 0.25)"}`,
              borderRadius: "6px",
              color: isQuickQuestionsOpen ? "#35F2D0" : "#B9A2FF",
              fontWeight: 600,
              cursor: isPending || activeRun !== null || droneMachine.isAnimating ? "not-allowed" : "pointer",
              transition: "all 0.15s ease"
            }}
          >
            <span>⚡</span>
            <span>Готові запитання (15)</span>
            <span style={{ fontSize: "9px" }}>▾</span>
          </button>

          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              color: "#6B6282",
              fontSize: "10.5px"
            }}
          >
            Enter ↵ надіслати · Shift+Enter новий рядок
          </span>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={2}
            placeholder={`Запитайте AI про ${symbol}...`}
            disabled={isPending || activeRun !== null || droneMachine.isAnimating}
            style={{
              flex: 1,
              padding: "9px 12px",
              background: "#130F22",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "8px",
              color: "#F1EEFF",
              fontSize: "12.5px",
              outline: "none",
              resize: "none",
              fontFamily: "inherit",
              lineHeight: "1.4"
            }}
          />
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={!input.trim() || isPending || activeRun !== null || droneMachine.isAnimating}
            style={{
              padding: "8px 16px",
              height: "38px",
              background:
                input.trim() && !isPending && !activeRun && !droneMachine.isAnimating
                  ? "linear-gradient(135deg, #7C4DFF 0%, #B24BFF 100%)"
                  : "#1A152B",
              border: "none",
              borderRadius: "8px",
              color:
                input.trim() && !isPending && !activeRun && !droneMachine.isAnimating
                  ? "#FFFFFF"
                  : "#5A5270",
              fontSize: "12px",
              fontWeight: 600,
              cursor:
                input.trim() && !isPending && !activeRun && !droneMachine.isAnimating
                  ? "pointer"
                  : "not-allowed",
              transition: "all 0.15s ease",
              display: "flex",
              alignItems: "center",
              gap: "4px"
            }}
          >
            <span>Надіслати</span>
            <span>↑</span>
          </button>
        </div>
      </div>
    </div>
  );
}
