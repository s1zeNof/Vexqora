import { redirect } from "next/navigation";
import { z } from "zod";
import { fetchRecentKlines } from "@crypto-bot/exchange";
import { accountConnectionSchema, createAccountClient } from "../../../../lib/account-client";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { formatPrice } from "../../../../lib/format";
import { sanitizeSymbol } from "@crypto-bot/shared";
import { SignalLiveStage } from "./signal-live-stage";
import type { SignalTradeItem } from "./signal-positions-table";
import { executeSignalAction, deleteSignalAction } from "./actions";

interface SignalPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ trade?: string }>;
}

export default async function SignalPage({ params, searchParams }: SignalPageProps) {
  const { id: rawId } = await params;
  const query = await searchParams;
  void query;

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);

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

  let availableBalance = 20050;
  if (account) {
    try {
      const b = await createAccountClient(account).getBalance();
      availableBalance = b.available;
    } catch {
      // fallback
    }
  }

  // 1. Fetch signal from DB if ID or symbol provided
  const signalSchema = z.object({
    id: z.string(),
    raw_text: z.string().nullable(),
    parsed: z.unknown(),
    status: z.string(),
    created_at: z.string()
  });
  type SignalRecord = z.infer<typeof signalSchema>;
  let signalRecord: SignalRecord | null = null;

  let formattedSymbol = "BTCUSDT";

  if (isUuid) {
    const { data } = await supabase
      .from("signals")
      .select("id, raw_text, parsed, status, created_at")
      .eq("id", rawId)
      .maybeSingle();
    const parsedSig = signalSchema.safeParse(data);
    if (parsedSig.success) {
      signalRecord = parsedSig.data;
      const parsedData = (signalRecord.parsed as { signal?: { symbol?: string } } | null)?.signal;
      const rawMatches = signalRecord.raw_text ? /([A-Z0-9]+USDT)/.exec(signalRecord.raw_text) : null;
      formattedSymbol = sanitizeSymbol(parsedData?.symbol ?? rawMatches?.[1] ?? "BTCUSDT");
    }
  } else {
    formattedSymbol = sanitizeSymbol(rawId);

    if (account) {
      const { data } = await supabase
        .from("signals")
        .select("id, raw_text, parsed, status, created_at")
        .eq("account_id", account.id)
        .ilike("raw_text", `%${formattedSymbol}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const parsedSig = signalSchema.safeParse(data);
      if (parsedSig.success) {
        signalRecord = parsedSig.data;
      }
    }
  }

  // 2. Compute Signal 48-Hour Lifecycle & Status
  const createdAtTime = signalRecord ? new Date(signalRecord.created_at).getTime() : Date.now();
  const ageHours = (Date.now() - createdAtTime) / (1000 * 60 * 60);
  const isArchived = ageHours > 48 || signalRecord?.status === "archived";
  const remainingHours = Math.max(1, Math.round(48 - ageHours));

  // 3. Fetch live 24h ticker info from Bybit Linear Public API
  let currentPrice = 67200;
  let price24hPcnt = "+1.84%";
  let changeNum = 1.84;
  let high24h = "68,450.00";
  let low24h = "65,120.00";
  let volume24h = "1.2B USDT";
  let fundingRate = "+0.0100%";

  try {
    const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${formattedSymbol}`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      next: { revalidate: 10 }
    });
    if (res.ok) {
      const json = await res.json() as { result?: { list?: Array<{
        lastPrice: string;
        price24hPcnt: string;
        highPrice24h: string;
        lowPrice24h: string;
        turnover24h: string;
        fundingRate?: string;
      }> } };
      const item = json.result?.list?.[0];
      if (item) {
        currentPrice = Number(item.lastPrice) || currentPrice;
        changeNum = Number(item.price24hPcnt) * 100;
        price24hPcnt = `${changeNum >= 0 ? "+" : ""}${changeNum.toFixed(2)}%`;
        high24h = formatPrice(Number(item.highPrice24h));
        low24h = formatPrice(Number(item.lowPrice24h));
        const turnover = Number(item.turnover24h);
        volume24h = turnover >= 1e9 ? `${(turnover / 1e9).toFixed(1)}B` : `${(turnover / 1e6).toFixed(1)}M`;
        if (item.fundingRate) {
          const fr = Number(item.fundingRate) * 100;
          fundingRate = `${fr >= 0 ? "+" : ""}${fr.toFixed(4)}%`;
        }
      }
    }
  } catch {
    // fallback defaults
  }

  // 4. Fetch Klines for chart
  const klines = await fetchRecentKlines(formattedSymbol, "15", 35).catch(() => []);

  // 5. Compute signal targets
  const parsedPreview = signalRecord?.parsed as {
    entryPrice?: number;
    signal?: {
      side?: "long" | "short";
      stopLoss?: number;
      takeProfits?: Array<{ price: number; sharePct: number }>;
    };
    opportunity?: {
      strategy?: string;
      rationale?: string;
      qualityScore?: number;
      qualityTier?: string;
      winProbabilityPct?: number;
      riskReward?: number;
    };
  } | null;

  const isLong = parsedPreview?.signal?.side ? parsedPreview.signal.side === "long" : changeNum >= 0;
  const side = isLong ? ("long" as const) : ("short" as const);
  const entry = parsedPreview?.entryPrice ?? currentPrice;
  const slDist = entry * 0.025;
  const stopLoss = parsedPreview?.signal?.stopLoss ?? (isLong ? entry - slDist : entry + slDist);

  const tps = parsedPreview?.signal?.takeProfits ?? [];
  const tp1 = tps[0]?.price ?? (isLong ? entry + slDist * 1.8 : entry - slDist * 1.8);
  const tp2 = tps[1]?.price ?? (isLong ? entry + slDist * 2.6 : entry - slDist * 2.6);
  const tp3 = tps[2]?.price ?? (isLong ? entry + slDist * 3.5 : entry - slDist * 3.5);

  const strategy = parsedPreview?.opportunity?.strategy ?? "Fair Value Gap (FVG) Mitigation & Expansion";
  const rationale = parsedPreview?.opportunity?.rationale ?? "Structural liquidity sweep followed by market structure shift (MSS) into discount value gap.";
  const qualityScore = parsedPreview?.opportunity?.qualityScore ? parsedPreview.opportunity.qualityScore.toFixed(1) : "9.5";
  const qualityTier = parsedPreview?.opportunity?.qualityTier ?? "A+";
  const winProbabilityPct = parsedPreview?.opportunity?.winProbabilityPct ?? 73;
  const riskReward = parsedPreview?.opportunity?.riskReward ?? 2.4;

  // 6. Fetch active trade and trade history from DB (Де ми входили по Live/Paper)
  const tradesList: SignalTradeItem[] = [];
  const historyTrades: SignalTradeItem[] = [];

  if (account) {
    const symbolOrFilter = signalRecord
      ? `symbol.eq.${formattedSymbol},symbol.eq.${formattedSymbol.replace("USDT", "")},signal_id.eq.${signalRecord.id}`
      : `symbol.eq.${formattedSymbol},symbol.eq.${formattedSymbol.replace("USDT", "")}`;

    const { data: rawTrades } = await supabase
      .from("trades")
      .select("id, symbol, side, status, entry_avg, qty, leverage, sl, trailing_stop, realized_pnl, opened_at, closed_at, exit_reason, exit_price, signal_id")
      .eq("account_id", account.id)
      .or(symbolOrFilter)
      .order("opened_at", { ascending: false, nullsFirst: false })
      .limit(10);

    if (rawTrades) {
      for (const t of rawTrades) {
        const side = t.side === "short" ? ("short" as const) : ("long" as const);
        const leverage = Number(t.leverage ?? 5);
        const entryPrice = Number(t.entry_avg ?? currentPrice);
        const qty = Number(t.qty ?? 0);
        const direction = side === "long" ? 1 : -1;
        const priceDiff = (currentPrice - entryPrice) * direction;

        const isActive = t.status === "active" || t.status === "entry_open";
        const pnlUsdt = isActive
          ? (qty > 0 ? priceDiff * qty : 0)
          : Number(t.realized_pnl ?? 0);
        const pnlPct = isActive
          ? (entryPrice > 0 ? (priceDiff / entryPrice) * 100 * leverage : 0)
          : (entryPrice > 0 && qty > 0 ? (pnlUsdt / ((entryPrice * qty) / leverage)) * 100 : 0);

        const ts = (t.trailing_stop as { controlMode?: "auto" | "manual" } | null) ?? null;
        const controlMode = ts?.controlMode ?? "auto";

        const item: SignalTradeItem = {
          id: String(t.id),
          symbol: String(t.symbol),
          side,
          leverage,
          entryPrice,
          markPrice: currentPrice,
          qty,
          pnlUsdt: Number(pnlUsdt.toFixed(2)),
          pnlPct: Number(pnlPct.toFixed(2)),
          sl: t.sl ? Number(t.sl) : null,
          tp1: tp1,
          status: String(t.status),
          opened_at: t.opened_at ? String(t.opened_at) : undefined,
          closed_at: t.closed_at ? String(t.closed_at) : undefined,
          exitReason: t.exit_reason ? String(t.exit_reason) : null,
          exitPrice: t.exit_price ? Number(t.exit_price) : null,
          controlMode,
          trailingStop: ts
        };

        if (t.status === "active" || t.status === "entry_open") {
          tradesList.push(item);
        } else {
          historyTrades.push(item);
        }
      }
    }
  }

  const activePosition = tradesList[0] || null;
  const recentHistoricalTrade = historyTrades[0] || null;

  const isPaperTrading = account?.exchange === "paper" || account?.environment === "demo";
  const tradingModeLabel = isPaperTrading ? "Paper Trading (Віртуальний рахунок)" : "Bybit Live (Реальний рахунок)";

  const targetSignalId = signalRecord?.id ?? null;

  const handleExecuteAction = async (data: {
    orderType: "Market" | "Limit";
    margin: number;
    leverage: number;
    limitPrice?: number | undefined;
    adaptedLevels?: {
      stopLoss: number;
      tp1: number;
      tp2: number;
      tp3: number;
    } | undefined;
  }) => {
    "use server";
    await executeSignalAction(formattedSymbol, side, data.margin, data.leverage, targetSignalId, {
      orderType: data.orderType,
      limitPrice: data.limitPrice,
      adaptedLevels: data.adaptedLevels
    });
  };

  const handleDeleteFromArchive = async () => {
    "use server";
    if (targetSignalId) {
      await deleteSignalAction(targetSignalId);
      redirect("/dashboard/signals");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%", maxWidth: "1232px", margin: "0 auto", paddingBottom: "40px" }}>
      <SignalLiveStage
        symbol={formattedSymbol}
        side={side}
        initialPrice={currentPrice}
        initialHigh24h={high24h}
        initialLow24h={low24h}
        initialPriceChangePct={price24hPcnt}
        initialVolume24h={volume24h}
        initialFundingRate={fundingRate}
        entry={entry}
        stopLoss={stopLoss}
        tp1={tp1}
        tp2={tp2}
        tp3={tp3}
        klines={klines}
        activePosition={activePosition}
        recentHistoricalTrade={recentHistoricalTrade}
        tradesList={tradesList}
        historyTrades={historyTrades}
        isPaperTrading={isPaperTrading}
        tradingModeLabel={tradingModeLabel}
        isArchived={isArchived}
        ageHours={ageHours}
        remainingHours={remainingHours}
        targetSignalId={targetSignalId}
        qualityScore={qualityScore}
        qualityTier={qualityTier}
        strategy={strategy}
        rationale={rationale}
        createdAtTime={createdAtTime}
        riskReward={riskReward}
        winProbabilityPct={winProbabilityPct}
        availableBalance={availableBalance}
        onExecute={handleExecuteAction}
        onDeleteFromArchive={handleDeleteFromArchive}
      />
    </div>
  );
}
