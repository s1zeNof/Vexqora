import { describe, expect, it } from "vitest";
import { formatCryptoPrice, sanitizeSymbol } from "./format";

describe("formatCryptoPrice", () => {
  it("handles empty or invalid values safely", () => {
    expect(formatCryptoPrice(null)).toBe("—");
    expect(formatCryptoPrice(undefined)).toBe("—");
    expect(formatCryptoPrice(0)).toBe("—");
    expect(formatCryptoPrice(NaN)).toBe("—");
  });

  it("formats large crypto prices with 2 decimals", () => {
    expect(formatCryptoPrice(67245.5)).toBe("67,245.50");
    expect(formatCryptoPrice(3400.123)).toBe("3,400.12");
  });

  it("formats mid-range crypto prices with 2-4 decimals", () => {
    expect(formatCryptoPrice(182.4)).toBe("182.40");
    expect(formatCryptoPrice(2.145)).toBe("2.145");
  });

  it("formats sub-dollar tokens with proper precision", () => {
    expect(formatCryptoPrice(0.1425)).toBe("0.1425");
    expect(formatCryptoPrice(0.0008397)).toBe("0.0008397");
    expect(formatCryptoPrice(0.00001045)).toBe("0.00001045");
  });
});

describe("sanitizeSymbol", () => {
  it("sanitizes pulse slugs with timestamps cleanly", () => {
    expect(sanitizeSymbol("pulse-IRYSUSDT-2987959")).toBe("IRYSUSDT");
    expect(sanitizeSymbol("PULSEIRYSUSDT2987959USDT")).toBe("IRYSUSDT");
    expect(sanitizeSymbol("pulse-BIRBUSDT-2987959")).toBe("BIRBUSDT");
    expect(sanitizeSymbol("PULSEBIRBUSDT2987959USDT")).toBe("BIRBUSDT");
    expect(sanitizeSymbol("pulse:ETHUSDT:long:12345")).toBe("ETHUSDT");
  });

  it("handles standard tickers and short symbols", () => {
    expect(sanitizeSymbol("BTCUSDT")).toBe("BTCUSDT");
    expect(sanitizeSymbol("btcusdt")).toBe("BTCUSDT");
    expect(sanitizeSymbol("BTC")).toBe("BTCUSDT");
    expect(sanitizeSymbol("IRYS")).toBe("IRYSUSDT");
    expect(sanitizeSymbol("")).toBe("BTCUSDT");
  });
});
