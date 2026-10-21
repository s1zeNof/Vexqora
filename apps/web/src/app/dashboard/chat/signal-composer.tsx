"use client";

import { useActionState } from "react";
import { cancelSignal, confirmSignal, previewSignal, type PreviewState } from "./actions";

const initialState: PreviewState = {};

export function SignalComposer() {
  const [state, action, pending] = useActionState(previewSignal, initialState);
  return (
    <section className="composer">
      <form action={action}>
        <label htmlFor="signal">Signal</label>
        <textarea id="signal" name="signal" rows={9} defaultValue={`BTCUSDT LONG
entry market
tp 66000 40%, 67000 30%, 68500 30%
sl 64000
trail 1% after tp1
lev 5
risk 1%`} required />
        <button disabled={pending}>{pending ? "Calculating…" : "Create preview"}</button>
      </form>
      {state.error ? <p className="error">{state.error}</p> : null}
      {state.preview && state.signalId ? (
        <article className="preview-card">
          <div className="preview-heading"><h2>{state.preview.signal.symbol} {state.preview.signal.side.toUpperCase()}</h2><span className="badge">Preview</span></div>
          <dl>
            <div><dt>Entry</dt><dd>{state.preview.entryPrice}</dd></div>
            <div><dt>Quantity</dt><dd>{state.preview.qty}</dd></div>
            <div><dt>Notional</dt><dd>${state.preview.notional.toFixed(2)}</dd></div>
            <div><dt>Risk</dt><dd>${state.preview.riskAmount.toFixed(2)} ({state.preview.riskPct.toFixed(2)}%)</dd></div>
            <div><dt>Leverage</dt><dd>{state.preview.leverage}×</dd></div>
            <div><dt>Weighted R:R</dt><dd>{state.preview.weightedRewardRisk.toFixed(2)}</dd></div>
          </dl>
          <div className="preview-actions">
            <form action={confirmSignal}><input type="hidden" name="signalId" value={state.signalId} /><button>Confirm</button></form>
            <form action={cancelSignal}><input type="hidden" name="signalId" value={state.signalId} /><button className="secondary">Cancel</button></form>
          </div>
        </article>
      ) : null}
    </section>
  );
}

