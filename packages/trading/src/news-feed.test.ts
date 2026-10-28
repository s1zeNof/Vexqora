import { describe, expect, it } from "vitest";
import { VerifiedNewsFeedService, type NewsFeedResult } from "./news-feed";
import type { NewsEvent } from "./news";

describe("Verified News Intelligence & Economic Calendar (P0-09, AT-03, AT-04)", () => {
  it("AT-03: ingests verified macro CPI event with source URL, timestamps, and high impact rating", async () => {
    const cpiEvent: NewsEvent = {
      id: "news-us-cpi-shock",
      sourceUrl: "https://www.bls.gov/cpi/news.htm",
      sourceType: "macro_calendar",
      publishedAt: new Date(Date.now() - 3600000).toISOString(),
      firstSeenAt: new Date(Date.now() - 3550000).toISOString(),
      receivedAt: new Date(Date.now() - 3500000).toISOString(),
      symbols: ["ALL_MARKETS", "BTCUSDT", "ETHUSDT", "XAUUSDT"],
      eventType: "macro_calendar",
      verificationStatus: "verified",
      confidenceInRelevance: 0.98,
      impactLevel: "high",
      title: "US CPI Inflation Comes In Hot at 3.4% YoY vs 3.1% Forecast",
      summary: "Higher than expected inflation pushes rate cut expectations back to Q3."
    };

    const mockService = new VerifiedNewsFeedService(async (): Promise<NewsFeedResult> => {
      await Promise.resolve();
      return {
        status: "ONLINE",
        source: "MockMacroFeed",
        asOfMs: Date.now(),
        eventsCount: 1,
        events: [cpiEvent],
        economicCalendar: [],
        qualityWarnings: []
      };
    });

    const feed = await mockService.fetchLatestEvents();
    expect(feed.status).toBe("ONLINE");
    expect(feed.events).toHaveLength(1);

    const btcAssessment = VerifiedNewsFeedService.evaluateFeedForSymbol(feed, "BTCUSDT");
    expect(btcAssessment.riskLevel).toBe("HIGH");
    expect(btcAssessment.hasHighImpactNews).toBe(true);
    expect(btcAssessment.activeEvents[0]?.sourceUrl).toBe("https://www.bls.gov/cpi/news.htm");

    // Also affects gold proxy XAUUSDT
    const goldAssessment = VerifiedNewsFeedService.evaluateFeedForSymbol(feed, "XAUUSDT");
    expect(goldAssessment.hasHighImpactNews).toBe(true);
    expect(goldAssessment.riskLevel).toBe("HIGH");
  });

  it("AT-04: offline news provider returns UNAVAILABLE and UNKNOWN risk, NEVER pretending all clear", async () => {
    const offlineService = new VerifiedNewsFeedService(async (): Promise<NewsFeedResult> => {
      await Promise.resolve();
      return {
        status: "UNAVAILABLE",
        source: "OfflineProviderMock",
        asOfMs: Date.now(),
        eventsCount: 0,
        events: [],
        economicCalendar: [],
        qualityWarnings: ["News upstream provider 503 gateway timeout"]
      };
    });

    const feed = await offlineService.fetchLatestEvents();
    expect(feed.status).toBe("UNAVAILABLE");

    const assessment = VerifiedNewsFeedService.evaluateFeedForSymbol(feed, "SOLUSDT");
    expect(assessment.riskLevel).toBe("UNKNOWN");
    expect(assessment.coverageStatus).toBe("UNAVAILABLE");
    expect(assessment.recommendation).toContain("UNAVAILABLE");
    expect(assessment.hasHighImpactNews).toBe(false); // Does not invent high impact, but explicitly UNKNOWN
  });

  it("identifies critical exchange incident (e.g. delisting or trading halt) with CRITICAL impact", () => {
    const delistEvent: NewsEvent = {
      id: "delist-1",
      sourceUrl: "https://announcements.bybit.com/delisting-token",
      sourceType: "official_announcement",
      publishedAt: new Date().toISOString(),
      firstSeenAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      symbols: ["SHITUSDT"],
      eventType: "exchange_announcement",
      verificationStatus: "verified",
      confidenceInRelevance: 1.0,
      impactLevel: "critical",
      title: "Bybit Will Delist SHITUSDT Perpetual Contract on Nov 1",
      summary: "Positions will be forcibly closed at index price upon delisting."
    };

    const feed: NewsFeedResult = {
      status: "ONLINE",
      source: "BybitAnnouncements",
      asOfMs: Date.now(),
      eventsCount: 1,
      events: [delistEvent],
      economicCalendar: [],
      qualityWarnings: []
    };

    const assessment = VerifiedNewsFeedService.evaluateFeedForSymbol(feed, "SHITUSDT");
    expect(assessment.riskLevel).toBe("CRITICAL");
    expect(assessment.hasHighImpactNews).toBe(true);
    expect(assessment.recommendation).toContain("NO_TRADE");
  });

  it("deduplicates identical rumor reposts by headline hash", () => {
    const events: NewsEvent[] = [
      {
        id: "1",
        sourceUrl: "https://twitter.com/post1",
        sourceType: "syndicated_feed",
        publishedAt: "2026-10-28T10:00:00Z",
        firstSeenAt: "2026-10-28T10:00:05Z",
        receivedAt: "2026-10-28T10:00:10Z",
        symbols: ["BTCUSDT"],
        eventType: "market_regulatory",
        verificationStatus: "unverified",
        confidenceInRelevance: 0.6,
        impactLevel: "medium",
        title: "SEC Rumor Regarding Ethereum ETF Staking Amendment",
        summary: "Rumors spread on Twitter regarding amendment filing."
      },
      {
        id: "2",
        sourceUrl: "https://telegram.org/channel/repost",
        sourceType: "syndicated_feed",
        publishedAt: "2026-10-28T10:01:00Z",
        firstSeenAt: "2026-10-28T10:01:05Z",
        receivedAt: "2026-10-28T10:01:10Z",
        symbols: ["BTCUSDT"],
        eventType: "market_regulatory",
        verificationStatus: "unverified",
        confidenceInRelevance: 0.6,
        impactLevel: "medium",
        title: "SEC Rumor Regarding Ethereum ETF Staking Amendment!!",
        summary: "Duplicate copy of the rumor."
      }
    ];

    const deduplicated = VerifiedNewsFeedService.deduplicateEvents(events);
    expect(deduplicated).toHaveLength(1);
    expect(deduplicated[0]?.id).toBe("1");
  });
});
