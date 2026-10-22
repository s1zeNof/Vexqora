"use client";

import { useActionState } from "react";
import { cancelSignal, confirmSignal, previewSignal, type PreviewState } from "./actions";

const initialState: PreviewState = {};

export function SignalComposer() {
  const [state, action, pending] = useActionState(previewSignal, initialState);
  return (
    <section className="composer">
      {state.error ? <p className="notice error">{state.error}</p> : null}
      {state.preview && state.signalId ? (
        <article className="preview-card">
          <div className="preview-heading"><div><span className={`badge ${state.preview.signal.side}`}>{state.preview.signal.side}</span><h2>{state.preview.signal.symbol} preview</h2></div><span className="kicker">Ready to confirm</span></div>
          <dl>
            <div><dt>Entry</dt><dd>{state.preview.entryPrice}</dd></div>
            <div><dt>Quantity</dt><dd>{state.preview.qty}</dd></div>
            <div><dt>Notional</dt><dd>${state.preview.notional.toFixed(2)}</dd></div>
            <div><dt>Risk</dt><dd>${state.preview.riskAmount.toFixed(2)} · {state.preview.riskPct.toFixed(2)}%</dd></div>
            <div><dt>Leverage</dt><dd>{state.preview.leverage}×</dd></div>
            <div><dt>Weighted R:R</dt><dd>1 : {state.preview.weightedRewardRisk.toFixed(2)}</dd></div>
          </dl>
          {state.preview.signal.takeProfits && state.preview.signal.takeProfits.length > 0 ? (
            <div style={{ marginTop: "12px", borderTop: "1px solid var(--line)", paddingTop: "8px" }}>
              <span className="kicker" style={{ color: "var(--aqua)" }}>🎯 Take Profit Targets</span>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${state.preview.signal.takeProfits.length}, 1fr)`, gap: "8px", marginTop: "6px" }}>
                {state.preview.signal.takeProfits.map((tp, idx) => (
                  <div key={idx} style={{ background: "#171229", padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--line)" }}>
                    <div style={{ fontSize: "10px", color: "var(--muted)" }}>TP {idx + 1} ({tp.sharePct}%)</div>
                    <strong className="mono positive" style={{ fontSize: "13px" }}>${tp.price}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="preview-actions">
            <form action={confirmSignal}><input type="hidden" name="signalId" value={state.signalId} /><button className="button primary">Confirm signal</button></form>
            <form action={cancelSignal}><input type="hidden" name="signalId" value={state.signalId} /><button className="button secondary">Cancel</button></form>
          </div>
        </article>
      ) : null}
      <form className="composer-bar" action={action}>
        <textarea
          aria-label="Signal"
          id="signal"
          name="signal"
          rows={1}
          placeholder='Сканувати будь-яку пару Bybit ("Scan SUI", "Scan NEAR", "Scan PEPE", "Scan All") або вставити готовий сигнал...'
          required
        />
        <button className="button secondary" type="button">Form</button>
        <button className="button primary" disabled={pending}>{pending ? "Checking…" : "Send"}</button>
      </form>
    </section>
  );
}

