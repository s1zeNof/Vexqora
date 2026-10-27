export type NewsEventType =
  | "exchange_announcement"
  | "token_unlock"
  | "macro_calendar"
  | "security_incident"
  | "protocol_upgrade"
  | "market_regulatory";

export type NewsImpactLevel = "critical" | "high" | "medium" | "low";

export type NewsVerificationStatus = "verified" | "unverified" | "debunked";

export type NewsSourceType =
  | "exchange_api"
  | "official_announcement"
  | "macro_calendar"
  | "syndicated_feed";

export interface NewsEvent {
  id: string;
  sourceUrl: string;
  sourceType: NewsSourceType;
  publishedAt: string; // ISO 8601
  firstSeenAt: string; // ISO 8601
  receivedAt: string; // ISO 8601
  symbols: string[];
  eventType: NewsEventType;
  verificationStatus: NewsVerificationStatus;
  confidenceInRelevance: number; // 0..1
  impactLevel: NewsImpactLevel;
  title: string;
  summary: string;
}

export interface NewsRiskAssessment {
  symbol: string;
  hasHighImpactNews: boolean;
  riskLevel: "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";
  coverageStatus: "ONLINE" | "DEGRADED" | "UNAVAILABLE";
  activeEvents: NewsEvent[];
  recommendation: string;
  asOfIso: string;
}

/**
 * Filter news events specifically relevant to a target cryptocurrency symbol.
 */
export function filterEventsBySymbol(events: NewsEvent[], symbol: string): NewsEvent[] {
  const norm = symbol.toUpperCase().replace(/USDT$/, "");
  const pairNorm = `${norm}USDT`;

  return events.filter((e) =>
    e.symbols.some((s) => {
      const sNorm = s.toUpperCase().replace(/USDT$/, "");
      return sNorm === norm || s.toUpperCase() === pairNorm || s.toUpperCase() === "ALL_MARKETS";
    })
  );
}

/**
 * Evaluates the impact level of a newly received event.
 */
export function classifyNewsImpact(event: Pick<NewsEvent, "eventType" | "title" | "summary">): NewsImpactLevel {
  const text = `${event.title} ${event.summary}`.toLowerCase();

  // Critical keywords: delisting, security exploit, emergency maintenance
  if (
    text.includes("delist") ||
    text.includes("exploit") ||
    text.includes("hack") ||
    text.includes("emergency maintenance") ||
    text.includes("halt trading")
  ) {
    return "critical";
  }

  // High impact: CPI, FOMC, rate decision, mainnet fork, margin tier change
  if (
    text.includes("fomc") ||
    text.includes("cpi") ||
    text.includes("interest rate") ||
    text.includes("token unlock") ||
    text.includes("leverage reduction") ||
    text.includes("margin change") ||
    text.includes("sec ")
  ) {
    return "high";
  }

  // Medium impact: network upgrade, new listings, scheduled maintenance
  if (text.includes("upgrade") || text.includes("maintenance") || text.includes("listing")) {
    return "medium";
  }

  return "low";
}

/**
 * Evaluates news-driven risk for an active or candidate trade setup.
 * Strictly respects P1.5 safety rules: If news feed is offline, reports UNKNOWN, never pretending "all news clear".
 */
export function evaluateNewsRiskForTrade(
  symbol: string,
  events: NewsEvent[] | null | undefined,
  coverageStatus: "ONLINE" | "DEGRADED" | "UNAVAILABLE" = "DEGRADED"
): NewsRiskAssessment {
  const asOfIso = new Date().toISOString();

  if (coverageStatus === "UNAVAILABLE" || !events) {
    return {
      symbol,
      hasHighImpactNews: false,
      riskLevel: "UNKNOWN",
      coverageStatus: "UNAVAILABLE",
      activeEvents: [],
      recommendation: "Новинний моніторинг наразі недоступний. Торгуйте з підвищеною обережністю.",
      asOfIso
    };
  }

  const matching = filterEventsBySymbol(events, symbol);
  const criticalEvents = matching.filter((e) => e.impactLevel === "critical");
  const highEvents = matching.filter((e) => e.impactLevel === "high");

  if (criticalEvents.length > 0) {
    return {
      symbol,
      hasHighImpactNews: true,
      riskLevel: "CRITICAL",
      coverageStatus,
      activeEvents: criticalEvents,
      recommendation: `Критична подія виявлена (${criticalEvents[0]!.title}). Рекомендовано NO_TRADE або закриття ризику.`,
      asOfIso
    };
  }

  if (highEvents.length > 0) {
    return {
      symbol,
      hasHighImpactNews: true,
      riskLevel: "HIGH",
      coverageStatus,
      activeEvents: highEvents,
      recommendation: `Високий новинний ризик (${highEvents[0]!.title}). Будьте уважні до підвищеної волатильності.`,
      asOfIso
    };
  }

  return {
    symbol,
    hasHighImpactNews: false,
    riskLevel: matching.length > 0 ? "MODERATE" : "LOW",
    coverageStatus,
    activeEvents: matching,
    recommendation: "Суттєвих новинних шоків або оголошень біржі не виявлено.",
    asOfIso
  };
}
