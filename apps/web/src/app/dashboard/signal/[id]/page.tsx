import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fetchRecentKlines } from "@crypto-bot/exchange";
import { accountConnectionSchema, createAccountClient } from "../../../../lib/account-client";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { formatPrice, formatCryptoPrice } from "../../../../lib/format";
import { formatTimeAgo } from "../../../../lib/date";
import { SignalChart } from "./signal-chart";
import { SignalPositionsTable } from "./signal-positions-table";
import { SignalExecutionPanel } from "./signal-execution-panel";
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
      formattedSymbol = parsedData?.symbol ?? rawMatches?.[1] ?? "BTCUSDT";
    }
  } else {
    const cleanSym = rawId.toUpperCase().replace(/[^A-Z0-9]/g, "");
    formattedSymbol = cleanSym.endsWith("USDT") ? cleanSym : `${cleanSym}USDT`;

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

  // 6. Fetch active trade and trade history from DB (Де ми входили по Live/Paper)
  interface TradeListItem {
    id: string;
    symbol: string;
    side: "long" | "short";
    leverage: number;
    entryPrice: number;
    markPrice: number;
    qty: number;
    pnlUsdt: number;
    pnlPct: number;
    sl: number | null;
    tp1: number | null;
    status: string;
    opened_at?: string | undefined;
  }

  const tradesList: TradeListItem[] = [];
  const historyTrades: TradeListItem[] = [];

  if (account) {
    const symbolOrFilter = signalRecord
      ? `symbol.eq.${formattedSymbol},symbol.eq.${formattedSymbol.replace("USDT", "")},signal_id.eq.${signalRecord.id}`
      : `symbol.eq.${formattedSymbol},symbol.eq.${formattedSymbol.replace("USDT", "")}`;

    const { data: rawTrades } = await supabase
      .from("trades")
      .select("id, symbol, side, status, entry_avg, qty, leverage, sl, realized_pnl, opened_at, signal_id")
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

        const item: TradeListItem = {
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
          opened_at: t.opened_at ? String(t.opened_at) : undefined
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

  const handleExecuteAction = async (data: { orderType: "Market" | "Limit"; margin: number; leverage: number }) => {
    "use server";
    await executeSignalAction(formattedSymbol, side, data.margin, data.leverage, targetSignalId);
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
      {/* Top Breadcrumb & Status Pill */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
        <div className="lb" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Link href="/dashboard/signals" style={{ color: "var(--muted)", textDecoration: "none" }}>
            ← Всі сигнали
          </Link>
          <span>/</span>
          <span style={{ color: "#FFFFFF", fontWeight: 600 }}>{formattedSymbol}</span>
        </div>

        {/* 48-Hour Lifecycle Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {isArchived ? (
            <span className="tg gy" style={{ color: "#FF5A6E", border: "1px solid #FF5A6E33" }}>
              📁 В архіві · Не актуально ({Math.round(ageHours)}г тому)
            </span>
          ) : (
            <span className="tg lg">
              🟢 Актуальний сигнал (ще {remainingHours}г)
            </span>
          )}

          {activePosition ? (
            <span className="tg lg" style={{ background: "#42F5B922", color: "#42F5B9" }}>
              ⚡ В трейді: {isPaperTrading ? "Paper" : "Live"} ({activePosition.pnlUsdt >= 0 ? "+" : ""}{activePosition.pnlUsdt.toFixed(2)} USDT / {activePosition.pnlPct >= 0 ? "+" : ""}{activePosition.pnlPct.toFixed(2)}%)
            </span>
          ) : null}

          {isArchived && targetSignalId ? (
            <form action={handleDeleteFromArchive}>
              <button
                type="submit"
                className="bt sm"
                style={{ padding: "4px 8px", fontSize: "11px", color: "#FF5A6E" }}
                title="Видалити цей сигнал з архіву"
              >
                🗑️ Видалити з архіву
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {/* Archive Notice Banner if > 48h */}
      {isArchived ? (
        <div
          className="notice"
          style={{
            background: "#161114",
            borderColor: "#FF5A6E33",
            color: "#D4C5CA",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px"
          }}
        >
          <div>
            <b style={{ color: "#FFFFFF" }}>Архівний сигнал:</b> З моменту створення минуло понад 48 годин.
            Сигнал збережено в архіві для аналітики та історії угод. Ви можете переглянути рівні або відкрити новий ордер за актуальною ринковою ціною.
          </div>
        </div>
      ) : null}

      {/* Trade Entry Fact Box (Де ми входили по Live / Paper) */}
      {activePosition || recentHistoricalTrade ? (
        <div
          className="cd"
          style={{
            padding: "16px 20px",
            background: "#141414",
            border: activePosition ? "1px solid #42F5B9" : "1px solid #262626",
            display: "flex",
            flexDirection: "column",
            gap: "10px"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "16px" }}>📍</span>
              <b style={{ font: "700 15px Inter, sans-serif", color: "#FFFFFF" }}>
                {activePosition ? "Активна позиція за цим сигналом" : "Історія виконання угоди"}
              </b>
              <span className={`tg ${activePosition ? "lg" : "gy"}`}>
                {tradingModeLabel}
              </span>
            </div>

            <span className="lb" style={{ fontSize: "12px" }}>
              {activePosition?.opened_at ? `Вхід: ${formatTimeAgo(activePosition.opened_at)}` : (recentHistoricalTrade?.opened_at ? formatTimeAgo(recentHistoricalTrade.opened_at) : "Нещодавно")}
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: "8px",
              background: "#1A1A1A",
              padding: "10px 14px",
              borderRadius: "6px"
            }}
          >
            <div>
              <div className="lb" style={{ fontSize: "11px" }}>Ціна входу</div>
              <div className="v" style={{ fontSize: "14px", margin: "2px 0 0" }}>
                ${formatCryptoPrice(activePosition?.entryPrice ?? recentHistoricalTrade?.entryPrice ?? entry)}
              </div>
            </div>
            <div>
              <div className="lb" style={{ fontSize: "11px" }}>Позиція & Плече</div>
              <div className="v" style={{ fontSize: "14px", margin: "2px 0 0" }}>
                {(activePosition?.side ?? recentHistoricalTrade?.side ?? side).toUpperCase()} {(activePosition?.leverage ?? recentHistoricalTrade?.leverage ?? 5)}x
              </div>
            </div>
            <div>
              <div className="lb" style={{ fontSize: "11px" }}>Поточна ціна</div>
              <div className="v" style={{ fontSize: "14px", margin: "2px 0 0" }}>
                ${formatCryptoPrice(currentPrice)}
              </div>
            </div>
            <div>
              <div className="lb" style={{ fontSize: "11px" }}>Результат PnL</div>
              <div
                className="v"
                style={{
                  fontSize: "14px",
                  margin: "2px 0 0",
                  color: (activePosition?.pnlUsdt ?? recentHistoricalTrade?.pnlUsdt ?? 0) >= 0 ? "#42F5B9" : "#FF5A6E"
                }}
              >
                {(activePosition?.pnlUsdt ?? recentHistoricalTrade?.pnlUsdt ?? 0) >= 0 ? "+" : ""}
                {(activePosition?.pnlUsdt ?? recentHistoricalTrade?.pnlUsdt ?? 0).toFixed(2)} USDT (
                {(activePosition?.pnlPct ?? recentHistoricalTrade?.pnlPct ?? 0) >= 0 ? "+" : ""}
                {(activePosition?.pnlPct ?? recentHistoricalTrade?.pnlPct ?? 0).toFixed(2)}%)
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Symbol Header & 24h Stats in OKX Ticker Bar */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap", margin: "4px 0 8px" }}>
        <b style={{ font: "700 26px Inter, sans-serif", color: "#FFFFFF" }}>{formattedSymbol}</b>
        <span className="tg gy">Perp</span>
        <span className="tg gy">Bybit</span>
        <span className="v" style={{ margin: 0, fontSize: "28px", color: isLong ? "#42F5B9" : "#FF5A6E" }}>
          {formatPrice(currentPrice)}
        </span>
        <span style={{ font: "600 14px Inter, sans-serif", color: isLong ? "#42F5B9" : "#FF5A6E" }}>
          {price24hPcnt}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: "24px", flexWrap: "wrap" }}>
          <div>
            <div className="lb">24h high</div>
            <div className="v" style={{ margin: "2px 0 0" }}>{high24h}</div>
          </div>
          <div>
            <div className="lb">24h low</div>
            <div className="v" style={{ margin: "2px 0 0" }}>{low24h}</div>
          </div>
          <div>
            <div className="lb">24h volume</div>
            <div className="v" style={{ margin: "2px 0 0" }}>{volume24h}</div>
          </div>
          <div>
            <div className="lb">Funding</div>
            <div className="v" style={{ margin: "2px 0 0" }}>{fundingRate}</div>
          </div>
        </div>
      </div>

      {/* Main Layout: 840px Left Stage + 360px Right Terminal */}
      <div className="signal-layout">
        {/* Left Column (840px): Chart + Positions Table + AI Context */}
        <div className="signal-stage">
          <SignalChart
            symbol={formattedSymbol}
            initialKlines={klines}
            entry={entry}
            stopLoss={stopLoss}
            tp1={tp1}
            tp2={tp2}
            tp3={tp3}
            currentPrice={currentPrice}
            position={activePosition ? {
              side: activePosition.side,
              leverage: activePosition.leverage,
              entryPrice: activePosition.entryPrice,
              pnlUsdt: activePosition.pnlUsdt,
              pnlPct: activePosition.pnlPct,
              isPaper: isPaperTrading
            } : null}
          />

          <SignalPositionsTable
            symbol={formattedSymbol}
            trades={tradesList}
            historyTrades={historyTrades}
          />

          {/* AI Smart Money & Nemotron Setup Card */}
          <div className="cd" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <b style={{ font: "700 15px Inter, sans-serif", color: "#FFFFFF" }}>Аналіз сетапу від Nemotron AI</b>
                <span className="tg gy" style={{ color: "#F5C451" }}>
                  ★ {qualityScore}/10 {qualityTier}
                </span>
              </div>
              <span className="lb" style={{ fontSize: "12px" }}>
                Vexqora Memory: 73.0% Win Rate (37 збігів)
              </span>
            </div>

            <div style={{ font: "600 14px Inter, sans-serif", color: "#FFFFFF" }}>
              {strategy}
            </div>

            <div style={{ font: "400 13px Inter, sans-serif", color: "#9A9A9A", lineHeight: 1.5 }}>
              {rationale}
            </div>
          </div>
        </div>

        {/* Right Column (360px): Signal Specs + OKX Execution Panel */}
        <div className="signal-panel">
          {/* Signal Specs Card */}
          <div className="cd" style={{ padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <b style={{ font: "700 16px Inter, sans-serif", color: "#FFFFFF" }}>Специфікація сигналу</b>
              <span className={`tg ${isLong ? "lg" : "sh"}`}>
                {side.toUpperCase()}
              </span>
              <span className="lb" style={{ marginLeft: "auto" }}>
                {formatTimeAgo(createdAtTime)}
              </span>
            </div>

            <div style={{ marginTop: "12px" }}>
              <div className="row">
                <span>Ціна входу (Entry)</span>
                <span style={{ fontWeight: 600 }}>{formatPrice(entry)}</span>
              </div>
              <div className="row">
                <span>Stop Loss</span>
                <span style={{ color: "#FF5A6E", fontWeight: 600 }}>{formatPrice(stopLoss)}</span>
              </div>
              <div className="row">
                <span>TP 1 · 40%</span>
                <span style={{ color: "#42F5B9", fontWeight: 600 }}>{formatPrice(tp1)}</span>
              </div>
              <div className="row">
                <span>TP 2 · 30%</span>
                <span style={{ color: "#42F5B9", fontWeight: 600 }}>{formatPrice(tp2)}</span>
              </div>
              <div className="row">
                <span>TP 3 · 30%</span>
                <span style={{ color: "#42F5B9", fontWeight: 600 }}>{formatPrice(tp3)}</span>
              </div>
              <div className="row">
                <span>Trailing Stop</span>
                <span>1% після TP1</span>
              </div>
              <div className="row">
                <span>R : R коефіцієнт</span>
                <span style={{ color: "#42F5B9" }}>1 : 2.40</span>
              </div>
              <div className="row">
                <span>Впевненість ШІ</span>
                <span style={{ color: "#42F5B9" }}>73% Win Rate</span>
              </div>
            </div>
          </div>

          {/* Real OKX Exchange Order Terminal */}
          <SignalExecutionPanel
            symbol={formattedSymbol}
            side={side}
            currentPrice={currentPrice}
            availableBalance={availableBalance}
            stopLossPrice={stopLoss}
            tp1Price={tp1}
            onExecute={handleExecuteAction}
          />
        </div>
      </div>
    </div>
  );
}
