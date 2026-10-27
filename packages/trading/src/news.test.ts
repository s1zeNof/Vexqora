import { describe, it, expect } from "vitest";
import {
  filterEventsBySymbol,
  classifyNewsImpact,
  evaluateNewsRiskForTrade,
  type NewsEvent
} from "./news";

describe("News & Event Intelligence (P1.5)", () => {
  const sampleEvents: NewsEvent[] = [
    {
      id: "ev-1",
      sourceUrl: "https://announcements.bybit.com/delist-sample",
      sourceType: "exchange_api",
      publishedAt: new Date().toISOString(),
      firstSeenAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      symbols: ["BADCOIN"],
      eventType: "exchange_announcement",
      verificationStatus: "verified",
      confidenceInRelevance: 1.0,
      impactLevel: "critical",
      title: "Bybit to Delist BADCOINUSDT Perpetual Contract",
      summary: "Trading will be suspended and positions settled automatically."
    },
    {
      id: "ev-2",
      sourceUrl: "https://calendar.macro/cpi",
      sourceType: "macro_calendar",
      publishedAt: new Date().toISOString(),
      firstSeenAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      symbols: ["ALL_MARKETS"],
      eventType: "macro_calendar",
      verificationStatus: "verified",
      confidenceInRelevance: 0.95,
      impactLevel: "high",
      title: "US CPI Release in 30 minutes",
      summary: "High volatility expected across crypto and derivatives markets."
    }
  ];

  it("filters events by symbol matching base and pairs", () => {
    const badcoinEvents = filterEventsBySymbol(sampleEvents, "BADCOINUSDT");
    expect(badcoinEvents).toHaveLength(2); // BADCOIN + ALL_MARKETS

    const solEvents = filterEventsBySymbol(sampleEvents, "SOLUSDT");
    expect(solEvents).toHaveLength(1); // Only ALL_MARKETS
  });

  it("classifies critical security and delisting notices", () => {
    expect(classifyNewsImpact({
      eventType: "exchange_announcement",
      title: "Notice of Delisting of TOKENUSDT",
      summary: "Positions will be closed"
    })).toBe("critical");

    expect(classifyNewsImpact({
      eventType: "macro_calendar",
      title: "Upcoming FOMC Rate Decision",
      summary: "Fed interest rate policy announcement"
    })).toBe("high");
  });

  it("honestly reports UNKNOWN risk if news feed is unavailable", () => {
    const res = evaluateNewsRiskForTrade("SOLUSDT", null, "UNAVAILABLE");
    expect(res.riskLevel).toBe("UNKNOWN");
    expect(res.coverageStatus).toBe("UNAVAILABLE");
    expect(res.hasHighImpactNews).toBe(false);
  });

  it("strictly forbids optimistic ONLINE when events list is empty", () => {
    const res = evaluateNewsRiskForTrade("SOLUSDT", [], "ONLINE");
    expect(res.riskLevel).toBe("UNKNOWN");
    expect(res.coverageStatus).toBe("UNAVAILABLE");
  });

  it("identifies critical risk for delisting notice", () => {
    const res = evaluateNewsRiskForTrade("BADCOINUSDT", sampleEvents, "ONLINE");
    expect(res.riskLevel).toBe("CRITICAL");
    expect(res.hasHighImpactNews).toBe(true);
    expect(res.recommendation).toContain("NO_TRADE");
  });
});
