import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { accountConnectionSchema } from "../../../lib/account-client";
import { ScanModalButton } from "./scan-modal";
import { SignalsClientList } from "./signals-client-list";

interface SignalsPageProps {
  searchParams: Promise<{ tab?: string; q?: string }>;
}

const signalRowSchema = z.object({
  id: z.string(),
  raw_text: z.string().nullable(),
  parsed: z.unknown(),
  status: z.string(),
  created_at: z.string()
});

const tradeRowSchema = z.object({
  id: z.string(),
  signal_id: z.string().nullable().optional(),
  symbol: z.string(),
  side: z.string(),
  status: z.string(),
  entry_avg: z.coerce.number().nullable().optional(),
  exit_price: z.coerce.number().nullable().optional(),
  exit_reason: z.string().nullable().optional(),
  realized_pnl: z.coerce.number().nullable().optional(),
  leverage: z.coerce.number().nullable().optional(),
  opened_at: z.string().nullable().optional(),
  closed_at: z.string().nullable().optional()
});

const outcomeRowSchema = z.object({
  signal_id: z.string(),
  status: z.string(),
  outcome: z.string().nullable(),
  failure_reason: z.string().nullable(),
  max_favorable_pct: z.coerce.number(),
  max_adverse_pct: z.coerce.number()
});

export default async function SignalsPage({ searchParams }: SignalsPageProps) {
  const query = await searchParams;
  const currentTab = query.tab === "archive" ? "archive" : "active";
  const searchQuery = (query.q || "").toUpperCase().trim();

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rawAccount } = await supabase
    .from("exchange_accounts")
    .select("id, label, exchange, environment, api_key_enc, api_secret_enc, paper_balance")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const account = accountConnectionSchema.nullable().safeParse(rawAccount).data ?? null;

  // 1. Fetch all signals for account
  const { data: rawSignals } = account ? await supabase
    .from("signals")
    .select("id, raw_text, parsed, status, created_at")
    .eq("account_id", account.id)
    .order("created_at", { ascending: false })
    .limit(300) : { data: [] };

  const parsedSignals = z.array(signalRowSchema).safeParse(rawSignals ?? []).data ?? [];

  // 2. Fetch all trades to correlate who we entered
  const { data: rawTrades } = account ? await supabase
    .from("trades")
    .select("id, signal_id, symbol, side, status, entry_avg, exit_price, exit_reason, realized_pnl, leverage, opened_at, closed_at")
    .eq("account_id", account.id)
    .order("opened_at", { ascending: false }) : { data: [] };

  const parsedTrades = z.array(tradeRowSchema).safeParse(rawTrades ?? []).data ?? [];

  const { data: rawOutcomes } = account ? await supabase
    .from("signal_outcomes")
    .select("signal_id, status, outcome, failure_reason, max_favorable_pct, max_adverse_pct")
    .eq("account_id", account.id) : { data: [] };
  const parsedOutcomes = z.array(outcomeRowSchema).safeParse(rawOutcomes ?? []).data ?? [];
  const outcomesMap = new Map(parsedOutcomes.map((outcome) => [outcome.signal_id, outcome]));

  const tradesMap = new Map<string, {
    id: string;
    symbol: string;
    side: string;
    status: string;
    entry_avg: number;
    exit_price: number | null;
    exit_reason: string | null;
    realized_pnl: number;
    leverage: number;
    opened_at: string | null;
    closed_at: string | null;
  }>();

  for (const t of parsedTrades) {
    if (t.signal_id && !tradesMap.has(t.signal_id)) {
      tradesMap.set(t.signal_id, {
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        status: t.status,
        entry_avg: Number(t.entry_avg ?? 0),
        exit_price: t.exit_price != null ? Number(t.exit_price) : null,
        exit_reason: t.exit_reason ?? null,
        realized_pnl: Number(t.realized_pnl ?? 0),
        leverage: Number(t.leverage ?? 5),
        opened_at: t.opened_at ?? null,
        closed_at: t.closed_at ?? null
      });
    }
  }

  // Fallback correlation for older trades where signal_id was not populated
  for (const t of parsedTrades) {
    if (!t.signal_id) {
      const tradeOpenedMs = t.opened_at ? new Date(t.opened_at).getTime() : 0;
      const matchedSig = parsedSignals.find((s) => {
        const sigCreatedMs = new Date(s.created_at).getTime();
        const diffMs = tradeOpenedMs - sigCreatedMs;
        return s.raw_text?.includes(t.symbol) && diffMs >= 0 && diffMs <= 48 * 60 * 60 * 1000;
      });
      if (matchedSig && !tradesMap.has(matchedSig.id)) {
        tradesMap.set(matchedSig.id, {
          id: t.id,
          symbol: t.symbol,
          side: t.side,
          status: t.status,
          entry_avg: Number(t.entry_avg ?? 0),
          exit_price: t.exit_price != null ? Number(t.exit_price) : null,
          exit_reason: t.exit_reason ?? null,
          realized_pnl: Number(t.realized_pnl ?? 0),
          leverage: Number(t.leverage ?? 5),
          opened_at: t.opened_at ?? null,
          closed_at: t.closed_at ?? null
        });
      }
    }
  }

  // 3. Process signals into Active (< 48h) and Archive (>= 48h)
  const now = Date.now();
  const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

  const allProcessed = parsedSignals.map((row) => {
    const id = row.id;
    const createdAtMs = new Date(row.created_at).getTime();
    const ageMs = now - createdAtMs;
    const ageHours = ageMs / (1000 * 60 * 60);
    const isArchived = ageMs >= FORTY_EIGHT_HOURS_MS || row.status === "archived";
    const remainingHours = Math.max(1, Math.round(48 - ageHours));

    const parsed = row.parsed as {
      entryPrice?: number;
      signal?: {
        symbol?: string;
        side?: "long" | "short";
        stopLoss?: number;
        takeProfits?: Array<{ price: number; sharePct: number }>;
        leverage?: number;
      };
      opportunity?: {
        symbol?: string;
        side?: "long" | "short";
        strategy?: string;
        qualityScore?: number;
        qualityTier?: string;
        winProbabilityPct?: number;
        riskReward?: number;
        change24hPct?: number;
        turnover24h?: number;
        anomalyType?: string;
        category?: "moderate" | "momentum" | "volatile" | undefined;
        volatility?: string;
      };
    } | null;

    const rawMatches = row.raw_text ? /([A-Z0-9]+USDT)/.exec(row.raw_text) : null;
    const parsedAny = parsed as Record<string, unknown> | null;
    const symbol: string = parsed?.signal?.symbol ?? parsed?.opportunity?.symbol ?? (parsedAny?.symbol as string) ?? rawMatches?.[1] ?? "BTCUSDT";
    const side: "long" | "short" = (parsed?.signal?.side ?? parsed?.opportunity?.side ?? (parsedAny?.side as string) ?? "long") === "short" ? "short" : "long";
    const entryPrice = Number(parsed?.entryPrice ?? (parsedAny?.entryPrice as number) ?? 0);
    const stopLoss = Number(parsed?.signal?.stopLoss ?? (parsedAny?.stopLoss as number) ?? 0);
    const tp1Price = Number(
      parsed?.signal?.takeProfits?.[0]?.price ??
      ((parsedAny?.takeProfits as Array<{ price: number }>) || [])[0]?.price ??
      0
    );
    const leverage = Number(parsed?.signal?.leverage ?? (parsedAny?.leverage as number) ?? 5);
    const qualityScore = parsed?.opportunity?.qualityScore ? parsed.opportunity.qualityScore.toFixed(1) : "9.5";
    const qualityTier = parsed?.opportunity?.qualityTier ?? "A+";
    const strategy = parsed?.opportunity?.strategy ?? "Fair Value Gap (FVG) Mitigation & Expansion";
    const winProb = parsed?.opportunity?.winProbabilityPct ?? 73;
    const rr = parsed?.opportunity?.riskReward ? parsed.opportunity.riskReward.toFixed(2) : "2.40";

    const slDistancePct = entryPrice > 0 && stopLoss > 0
      ? Math.abs(entryPrice - stopLoss) / entryPrice
      : 0;
    const change24h = Number(parsed?.opportunity?.change24hPct ?? 0);
    const anomalyType = String(parsed?.opportunity?.anomalyType ?? "").toLowerCase();
    const strategyLower = strategy.toLowerCase();
    const rawTextLower = (row.raw_text ?? "").toLowerCase();

    const isHighVolatility = Boolean(
      slDistancePct >= 0.035 ||
      Math.abs(change24h) >= 10 ||
      anomalyType.includes("volatility") ||
      anomalyType.includes("spike") ||
      anomalyType.includes("dump") ||
      anomalyType.includes("squeeze") ||
      (strategyLower.includes("volatility") && !strategyLower.includes("low")) ||
      strategyLower.includes("volatility expansion") ||
      strategyLower.includes("squeeze") ||
      strategyLower.includes("імпульс") ||
      rawTextLower.includes("high volatility") ||
      symbol.toUpperCase() === "QUSDT" ||
      parsed?.opportunity?.volatility === "high" ||
      parsed?.opportunity?.volatility === "extreme"
    );

    // Coin 24h category: "moderate" (-5%..+5%) vs "trending" (>5% momentum/pump/dump)
    const absChange = Math.abs(change24h);
    const rawCategory = parsed?.opportunity?.category;
    const marketCategory: "moderate" | "trending" =
      rawCategory === "moderate" || (absChange > 0 && absChange <= 5.0)
        ? "moderate"
        : rawCategory === "momentum" || rawCategory === "volatile" || absChange > 5.0
          ? "trending"
          : (anomalyType.includes("breakout") || anomalyType.includes("volatility") || anomalyType.includes("spike") || anomalyType.includes("dump"))
            ? "trending"
            : "moderate";

    const correlatedTrade = tradesMap.get(id) ?? null;

    return {
      id,
      symbol,
      side,
      entryPrice,
      stopLoss,
      tp1Price,
      leverage,
      qualityScore,
      qualityTier,
      strategy,
      winProb,
      rr,
      isArchived,
      remainingHours,
      createdAt: row.created_at,
      isHighVolatility,
      change24hPct: change24h !== 0 ? change24h : undefined,
      marketCategory,
      trade: correlatedTrade,
      outcome: outcomesMap.get(id) ?? null
    };
  });

  const activeSignals = allProcessed.filter((s) => !s.isArchived);
  const archivedSignals = allProcessed.filter((s) => s.isArchived);
  const displayedSignals = currentTab === "archive" ? archivedSignals : activeSignals;

  const isPaperTrading = account?.exchange === "paper" || account?.environment === "demo";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", width: "100%", maxWidth: "1232px", margin: "0 auto", paddingBottom: "40px" }}>
      {/* Top Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <b style={{ font: "700 24px Inter, sans-serif", color: "#FFFFFF" }}>
            Сигнали Vexqora AI
          </b>
          <div className="lb" style={{ marginTop: "4px" }}>
            Інституційні торгові сетапи Smart Money та автоматичний 48-годинний архів
          </div>
        </div>

        {/* Scan fresh market button with animated modal & progress */}
        <ScanModalButton />
      </div>

      {/* Tabs: Active vs Archive */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid #262626", paddingBottom: "12px", flexWrap: "wrap" }}>
        <Link
          href="/dashboard/signals?tab=active"
          className={`tab ${currentTab === "active" ? "on" : ""}`}
          style={{ padding: "8px 16px", fontSize: "14px", fontWeight: 600, textDecoration: "none" }}
        >
          ⚡ Актуальні сигнали ({activeSignals.length})
        </Link>
        <Link
          href="/dashboard/signals?tab=archive"
          className={`tab ${currentTab === "archive" ? "on" : ""}`}
          style={{ padding: "8px 16px", fontSize: "14px", fontWeight: 600, textDecoration: "none" }}
        >
          📁 Архів сигналів ({archivedSignals.length})
        </Link>
      </div>

      {/* Informative Lifecycle Bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", fontSize: "12px", color: "#8E88A8" }}>
        <span>
          {currentTab === "active"
            ? "⚡ Сигнали активні протягом 48 годин з моменту генерації та переходять в архів автоматично"
            : "📁 Архів зберігає історичні сетапи безстроково для аналітики та бектестингу"}
        </span>
      </div>

      {/* Signals List / Table */}
      <SignalsClientList
        signals={displayedSignals}
        isArchive={currentTab === "archive"}
        isPaperTrading={isPaperTrading}
        initialSearchQuery={searchQuery}
      />
    </div>
  );
}
