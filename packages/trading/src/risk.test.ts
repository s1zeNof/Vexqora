import type { InstrumentInfo, Signal } from "@crypto-bot/shared";
import { describe, expect, it } from "vitest";
import { createTradePreview, RiskValidationError, roundToStep, type RiskSettings } from "./risk";

const instrument: InstrumentInfo = { symbol: "BTCUSDT", tickSize: 0.1, qtyStep: 0.001, minQty: 0.001, minNotional: 5, maxLeverage: 100 };
const settings: RiskSettings = { riskPerTradePct: 1, maxLeverage: 10, maxOpenPositions: 3, maxDailyLossPct: 5, killSwitch: false };
const longSignal: Signal = {
  symbol: "BTCUSDT", side: "long", entry: { type: "limit", price: 65_000 }, stopLoss: 64_000,
  takeProfits: [{ price: 66_000, sharePct: 40 }, { price: 67_000, sharePct: 60 }], source: "chat", leverage: 5
};

describe("risk preview", () => {
  it("sizes by the smaller of risk and leverage limits", () => {
    const preview = createTradePreview(longSignal, instrument, settings, { balance: 10_000, marketPrice: 65_000, openPositions: 0, dailyPnl: 0 });
    expect(preview.qty).toBe(0.1);
    expect(preview.qtyStep).toBe(0.001);
    expect(preview.riskAmount).toBe(100);
    expect(preview.weightedRewardRisk).toBe(1.6);
  });

  it("validates short target direction and ordering", () => {
    const signal: Signal = { ...longSignal, side: "short", stopLoss: 66_000, takeProfits: [{ price: 64_000, sharePct: 50 }, { price: 63_000, sharePct: 50 }] };
    expect(createTradePreview(signal, instrument, settings, { balance: 10_000, marketPrice: 65_000, openPositions: 0, dailyPnl: 0 }).qty).toBe(0.1);
  });

  it("blocks invalid stops, kill switch and daily loss", () => {
    const context = { balance: 10_000, marketPrice: 65_000, openPositions: 0, dailyPnl: 0 };
    expect(() => createTradePreview({ ...longSignal, stopLoss: 66_000 }, instrument, settings, context)).toThrow("below entry");
    expect(() => createTradePreview(longSignal, instrument, { ...settings, killSwitch: true }, context)).toThrow("Kill switch");
    expect(() => createTradePreview(longSignal, instrument, settings, { ...context, dailyPnl: -500 })).toThrow(RiskValidationError);
  });

  it("rounds quantities down to the exchange step", () => {
    expect(roundToStep(0.12399, 0.001, "down")).toBe(0.123);
    expect(roundToStep(65_000.04, 0.1)).toBe(65_000);
  });
});
