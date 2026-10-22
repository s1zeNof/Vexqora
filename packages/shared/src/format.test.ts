import { describe, expect, it } from "vitest";
import { formatCryptoPrice } from "./format";

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
