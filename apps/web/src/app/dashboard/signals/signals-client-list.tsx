"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { formatTimeAgo } from "../../../lib/date";
import { formatCryptoPrice } from "../../../lib/format";
import { confirmSignal } from "../chat/actions";
import { deleteSignalAction } from "../signal/[id]/actions";

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
  trade: {
    id: string;
    symbol: string;
    side: string;
    status: string;
    entry_avg: number;
    realized_pnl: number;
    leverage: number;
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
}

export function SignalsClientList({ signals, isArchive, isPaperTrading }: SignalsClientListProps) {
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {signals.map((s) => {
        const isLong = s.side === "long";
        const hasTrade = Boolean(s.trade);
        const isTradeActive = s.trade?.status === "active" || s.trade?.status === "entry_open";

        return (
          <article
            key={s.id}
            className="cd"
            style={{
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              border: isTradeActive ? "1px solid #42F5B9" : "1px solid #262626"
            }}
          >
            {/* Top Bar: Symbol, Badges, Status Pill & Time */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
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

                {/* In-Trade Fact Badge */}
                {hasTrade ? (
                  <span
                    className={`tg ${isTradeActive ? "lg" : "gy"}`}
                    style={{
                      background: isTradeActive ? "#42F5B922" : "#1A1A1A",
                      border: isTradeActive ? "1px solid #42F5B9" : "1px solid #262626"
                    }}
                  >
                    🎯 {isTradeActive ? "В трейді" : "Закрито"}: {isPaperTrading ? "Paper" : "Live"} (Вхід ${formatCryptoPrice(s.trade?.entry_avg ?? s.entryPrice)})
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
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {s.isArchived ? (
                  <span className="tg gy" style={{ color: "#FF5A6E", border: "1px solid #FF5A6E33" }}>
                    📁 Не актуально (в архіві)
                  </span>
                ) : (
                  <span className="tg lg">
                    🟢 Актуально (ще {s.remainingHours}г)
                  </span>
                )}

                <span className="lb" style={{ fontSize: "12px" }}>
                  {formatTimeAgo(s.createdAt)}
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
                background: "#1A1A1A",
                padding: "10px 14px",
                borderRadius: "6px",
                border: "1px solid #262626"
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", marginTop: "4px" }}>
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
                <span>Відкрити термінал</span>
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
          </article>
        );
      })}
    </div>
  );
}
