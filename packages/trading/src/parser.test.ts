import { describe, expect, it } from "vitest";
import { parseSignalText, SignalParseError } from "./parser";

describe("parseSignalText", () => {
  it("parses the documented signal format", () => {
    const signal = parseSignalText(`BTCUSDT LONG
entry 65000
tp 66000 40%, 67000 30%, 68500 30%
sl 64000
trail 1% after tp1
lev 5
risk 1%`);
    expect(signal).toMatchObject({ symbol: "BTCUSDT", side: "long", leverage: 5, riskPct: 1 });
    expect(signal.takeProfits).toHaveLength(3);
    expect(signal.trailingStop?.distance).toEqual({ type: "percent", value: 1 });
  });

  it("parses market and range entries", () => {
    expect(parseSignalText("ETHUSDT SHORT\nentry market\ntp 3000 100%\nsl 4000").entry).toEqual({ type: "market" });
    expect(parseSignalText("ETHUSDT LONG\nentry 3000-3100\ntp 3500 100%\nsl 2900").entry).toEqual({ type: "range", from: 3000, to: 3100 });
  });

  it("rejects incomplete signals", () => {
    expect(() => parseSignalText("BTCUSDT LONG\nentry 65000")).toThrow(SignalParseError);
  });
});

