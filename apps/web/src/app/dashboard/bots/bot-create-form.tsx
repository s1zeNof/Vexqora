"use client";

import { useState } from "react";
import { createPaperBot } from "./actions";

interface BotCreateFormProps {
  paperBalance: number;
}

export function BotCreateForm({ paperBalance }: BotCreateFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [capital, setCapital] = useState("");
  const [isCustomRisk, setIsCustomRisk] = useState(false);
  const [goalAction, setGoalAction] = useState<"pause" | "stop" | "continue">("pause");

  const setCapitalPreset = (val: number) => {
    setCapital(String(Math.min(paperBalance, Math.max(1, val))));
  };

  return (
    <section className="bot-creation-wrap">
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="bot-create-trigger"
        >
          <span className="bot-create-trigger__icon">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 4v12M4 10h12" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="bot-create-trigger__text">
            <strong>Create Autonomous Bot</strong>
            <span>Set up a new Paper trading bot with algorithmic execution</span>
          </div>
          <span className="bot-create-trigger__badge">Paper Mode</span>
        </button>
      ) : (
        <div className="bot-form-card">
          <div className="bot-form-card__header">
            <div className="bot-form-card__headline">
              <span className="bot-form-card__icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <rect x="3" y="11" width="18" height="10" rx="3" />
                  <circle cx="12" cy="5" r="2" />
                  <path d="M12 7v4" />
                  <line x1="8" y1="16" x2="8.01" y2="16" strokeWidth="2.5" strokeLinecap="round" />
                  <line x1="16" y1="16" x2="16.01" y2="16" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </span>
              <div>
                <h3>Deploy New AI Bot</h3>
                <p>Pure Paper Trading · No real assets at risk · Real-time market pipeline</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="bot-form-card__close"
              aria-label="Close form"
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 5L5 15M5 5l10 10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <form action={createPaperBot} className="bot-native-form">
            <div className="bot-form-balance-banner">
              <div className="bot-form-balance-banner__info">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="4" width="16" height="12" rx="2" />
                  <circle cx="14" cy="10" r="1.5" />
                  <path d="M6 8h4" />
                </svg>
                <span>Available Paper balance:</span>
              </div>
              <strong className="mono">${paperBalance.toFixed(2)} USDT</strong>
            </div>

            <div className="bot-form-fields-grid">
              {/* Bot Name with Floating Label */}
              <div className="floating-field floating-field--full">
                <div className="floating-field__input-wrap">
                  <span className="floating-field__icon">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M4 6a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
                      <path d="M7 10h6M7 13h4" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    id="bf-name"
                    name="name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={60}
                    placeholder=" "
                    className="floating-field__input"
                  />
                  <label htmlFor="bf-name" className="floating-field__label">
                    Bot Name (e.g. Scalping Alpha BTC)
                  </label>
                </div>
              </div>

              {/* Description with Floating Label */}
              <div className="floating-field floating-field--full">
                <div className="floating-field__input-wrap">
                  <span className="floating-field__icon">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M4 4h12v12H4z" rx="1" />
                      <path d="M7 8h6M7 12h4" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    id="bf-desc"
                    name="description"
                    type="text"
                    maxLength={160}
                    placeholder=" "
                    className="floating-field__input"
                  />
                  <label htmlFor="bf-desc" className="floating-field__label">
                    Description & Instructions (Optional)
                  </label>
                </div>
              </div>

              {/* Allocated Capital */}
              <div className="floating-field">
                <div className="floating-field__input-wrap">
                  <span className="floating-field__icon">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <circle cx="10" cy="10" r="7" />
                      <path d="M10 6v8M7.5 8h4a1.5 1.5 0 010 3h-3a1.5 1.5 0 000 3h4" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    id="bf-capital"
                    name="capital"
                    type="number"
                    required
                    min={1}
                    max={paperBalance}
                    step="0.01"
                    value={capital}
                    onChange={(e) => setCapital(e.target.value)}
                    placeholder=" "
                    className="floating-field__input mono"
                  />
                  <label htmlFor="bf-capital" className="floating-field__label">
                    Allocated Capital (USDT)
                  </label>
                </div>
                <div className="capital-chips">
                  <button type="button" onClick={() => setCapitalPreset(10)} className="capital-chip">10$</button>
                  <button type="button" onClick={() => setCapitalPreset(25)} className="capital-chip">25$</button>
                  <button type="button" onClick={() => setCapitalPreset(50)} className="capital-chip">50$</button>
                  <button type="button" onClick={() => setCapitalPreset(Math.floor(paperBalance * 0.5))} className="capital-chip">50%</button>
                  <button type="button" onClick={() => setCapitalPreset(Math.floor(paperBalance))} className="capital-chip">MAX</button>
                </div>
              </div>

              {/* Target Balance */}
              <div className="floating-field">
                <div className="floating-field__input-wrap">
                  <span className="floating-field__icon">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <circle cx="10" cy="10" r="7" />
                      <circle cx="10" cy="10" r="3" />
                      <line x1="10" y1="3" x2="10" y2="1" strokeLinecap="round" />
                      <line x1="10" y1="19" x2="10" y2="17" strokeLinecap="round" />
                      <line x1="3" y1="10" x2="1" y2="10" strokeLinecap="round" />
                      <line x1="19" y1="10" x2="17" y2="10" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    id="bf-target"
                    name="target"
                    type="number"
                    min={1}
                    step="0.01"
                    placeholder=" "
                    className="floating-field__input mono"
                  />
                  <label htmlFor="bf-target" className="floating-field__label">
                    Target Balance (USDT) — Optional
                  </label>
                </div>
                <div className="field-hint">
                  Goal target. Bot executes action below when reached.
                </div>
              </div>
            </div>

            {/* AI Risk Management Segment */}
            <div className="risk-segment">
              <div className="risk-segment__header">
                <div className="risk-segment__title">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M10 2L3 5v5c0 4.5 3 8.5 7 9.5 4-1 7-5 7-9.5V5l-7-3z" strokeLinejoin="round" />
                    <path d="M8 10l1.5 1.5L13 8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Risk Management Policy</span>
                </div>
                <div className="risk-mode-toggle">
                  <button
                    type="button"
                    onClick={() => setIsCustomRisk(false)}
                    className={`risk-mode-btn ${!isCustomRisk ? "risk-mode-btn--active" : ""}`}
                  >
                    AI Dynamic (Auto)
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCustomRisk(true)}
                    className={`risk-mode-btn ${isCustomRisk ? "risk-mode-btn--active" : ""}`}
                  >
                    Custom Limits
                  </button>
                </div>
              </div>

              {!isCustomRisk ? (
                <div className="risk-auto-banner">
                  <div className="risk-auto-banner__dot" />
                  <p>
                    <strong>Autonomous Risk Engine Enabled:</strong> The AI dynamically sizes positions according to current market regime, order-flow liquidity, and asset volatility. Direction (Long/Short) is chosen automatically.
                  </p>
                </div>
              ) : (
                <div className="risk-custom-grid">
                  <div className="floating-field">
                    <div className="floating-field__input-wrap">
                      <span className="floating-field__icon">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                          <path d="M12 4v12M8 8l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <input
                        id="bf-risk"
                        name="risk_per_trade_pct"
                        type="number"
                        min={0.1}
                        max={5}
                        step="0.1"
                        defaultValue={1}
                        placeholder=" "
                        className="floating-field__input mono"
                      />
                      <label htmlFor="bf-risk" className="floating-field__label">
                        Risk per trade (%)
                      </label>
                    </div>
                    <span className="field-hint">Range 0.1% – 5.0% of allocated balance</span>
                  </div>

                  <div className="floating-field">
                    <div className="floating-field__input-wrap">
                      <span className="floating-field__icon">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                          <circle cx="10" cy="10" r="7" />
                          <path d="M10 6v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <input
                        id="bf-dailyloss"
                        name="max_daily_loss_pct"
                        type="number"
                        min={1}
                        max={25}
                        step="0.5"
                        defaultValue={5}
                        placeholder=" "
                        className="floating-field__input mono"
                      />
                      <label htmlFor="bf-dailyloss" className="floating-field__label">
                        Max daily loss (%)
                      </label>
                    </div>
                    <span className="field-hint">Bot halts if daily loss touches limit (1% – 25%)</span>
                  </div>
                </div>
              )}
            </div>

            {/* Goal Action Segment */}
            <div className="goal-action-segment">
              <span className="goal-action-label">Action when target balance is reached:</span>
              <div className="goal-action-options">
                <input type="hidden" name="goal_action" value={goalAction} />
                <button
                  type="button"
                  onClick={() => setGoalAction("pause")}
                  className={`goal-btn ${goalAction === "pause" ? "goal-btn--active" : ""}`}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <path d="M4.5 3h2v10h-2V3zm5 0h2v10h-2V3z" />
                  </svg>
                  <span>Pause Bot</span>
                </button>
                <button
                  type="button"
                  onClick={() => setGoalAction("stop")}
                  className={`goal-btn ${goalAction === "stop" ? "goal-btn--active" : ""}`}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <rect x="3" y="3" width="10" height="10" rx="1.5" />
                  </svg>
                  <span>Stop Bot</span>
                </button>
                <button
                  type="button"
                  onClick={() => setGoalAction("continue")}
                  className={`goal-btn ${goalAction === "continue" ? "goal-btn--active" : ""}`}
                >
                  <svg viewBox="0 0 16 16" fill="currentColor">
                    <path d="M4 3l9 5-9 5V3z" />
                  </svg>
                  <span>Continue</span>
                </button>
              </div>
            </div>

            {/* Form Footer */}
            <div className="bot-form-footer">
              <div className="bot-form-footer__notice">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="6" />
                  <path d="M8 5v3.5M8 11h.01" strokeLinecap="round" />
                </svg>
                <span>Created bots start in Stopped mode. Activate manually when ready.</span>
              </div>
              <div className="bot-form-footer__actions">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="btn-cancel"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-deploy">
                  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M9 2l5 5-5 5M14 7H4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Create Bot</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
