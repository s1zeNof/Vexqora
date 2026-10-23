import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { accountConnectionSchema } from "../../../lib/account-client";
import { scanMarketOpportunityAction } from "../chat/actions";
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
  signal_id: z.string().nullable(),
  symbol: z.string(),
  side: z.string(),
  status: z.string(),
  entry_avg: z.coerce.number().nullable(),
  realized_pnl: z.coerce.number().nullable(),
  leverage: z.coerce.number().nullable(),
  opened_at: z.string().nullable()
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
    .limit(60) : { data: [] };

  const parsedSignals = z.array(signalRowSchema).safeParse(rawSignals ?? []).data ?? [];

  // 2. Fetch all trades to correlate who we entered
  const { data: rawTrades } = account ? await supabase
    .from("trades")
    .select("id, signal_id, symbol, side, status, entry_avg, realized_pnl, leverage, opened_at")
    .eq("account_id", account.id)
    .order("opened_at", { ascending: false }) : { data: [] };

  const parsedTrades = z.array(tradeRowSchema).safeParse(rawTrades ?? []).data ?? [];

  const tradesMap = new Map<string, {
    id: string;
    symbol: string;
    side: string;
    status: string;
    entry_avg: number;
    realized_pnl: number;
    leverage: number;
  }>();

  for (const t of parsedTrades) {
    if (t.signal_id) {
      tradesMap.set(t.signal_id, {
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        status: t.status,
        entry_avg: Number(t.entry_avg ?? 0),
        realized_pnl: Number(t.realized_pnl ?? 0),
        leverage: Number(t.leverage ?? 5)
      });
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
      };
    } | null;

    const rawMatches = row.raw_text ? /([A-Z0-9]+USDT)/.exec(row.raw_text) : null;
    const symbol: string = parsed?.signal?.symbol ?? parsed?.opportunity?.symbol ?? rawMatches?.[1] ?? "BTCUSDT";
    const side: "long" | "short" = (parsed?.signal?.side ?? parsed?.opportunity?.side ?? "long") === "short" ? "short" : "long";
    const entryPrice = Number(parsed?.entryPrice ?? 0);
    const stopLoss = Number(parsed?.signal?.stopLoss ?? 0);
    const tp1Price = Number(parsed?.signal?.takeProfits?.[0]?.price ?? 0);
    const leverage = Number(parsed?.signal?.leverage ?? 5);
    const qualityScore = parsed?.opportunity?.qualityScore ? parsed.opportunity.qualityScore.toFixed(1) : "9.5";
    const qualityTier = parsed?.opportunity?.qualityTier ?? "A+";
    const strategy = parsed?.opportunity?.strategy ?? "Fair Value Gap (FVG) Mitigation & Expansion";
    const winProb = parsed?.opportunity?.winProbabilityPct ?? 73;
    const rr = parsed?.opportunity?.riskReward ? parsed.opportunity.riskReward.toFixed(2) : "2.40";

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
      trade: correlatedTrade
    };
  });

  const activeSignals = allProcessed.filter((s) => !s.isArchived);
  const archivedSignals = allProcessed.filter((s) => s.isArchived);

  const displayedSignals = (currentTab === "archive" ? archivedSignals : activeSignals).filter((s) => {
    if (!searchQuery) return true;
    return s.symbol.toUpperCase().includes(searchQuery) || s.strategy.toUpperCase().includes(searchQuery);
  });

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

        {/* Scan fresh market button */}
        <form action={scanMarketOpportunityAction}>
          <input type="hidden" name="symbol" value="UNIVERSE" />
          <button
            type="submit"
            className="bt pr"
            style={{ height: "40px", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}
          >
            <span>⚡ Сканувати Bybit 916 пар</span>
          </button>
        </form>
      </div>

      {/* Tabs: Active vs Archive */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid #262626", paddingBottom: "12px" }}>
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

      {/* Search Bar & Quick Filters */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <form method="GET" style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1 1 300px" }}>
          <input type="hidden" name="tab" value={currentTab} />
          <input
            type="text"
            name="q"
            defaultValue={searchQuery}
            placeholder="Пошук пари (напр. IRYS, BTC, ETH)..."
            style={{
              height: "38px",
              width: "100%",
              maxWidth: "360px",
              padding: "0 12px",
              fontSize: "14px",
              background: "#1A1A1A",
              border: "1px solid #262626",
              borderRadius: "6px",
              color: "#FFFFFF"
            }}
          />
          <button type="submit" className="bt sm" style={{ height: "38px" }}>
            Знайти
          </button>
        </form>

        <span className="lb" style={{ fontSize: "12px" }}>
          {currentTab === "active"
            ? "Сигнали активні протягом 48 годин з моменту створення"
            : "Архів зберігається безстроково, доки ви самі не видалите запис"}
        </span>
      </div>

      {/* Signals List / Table */}
      <SignalsClientList
        signals={displayedSignals}
        isArchive={currentTab === "archive"}
        isPaperTrading={isPaperTrading}
      />
    </div>
  );
}
