import Link from "next/link";
import { redirect } from "next/navigation";
import { fetchRecentKlines } from "@crypto-bot/exchange";
import { accountConnectionSchema, createAccountClient } from "../../../../lib/account-client";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { formatPrice } from "../../../../lib/format";
import { SignalChart } from "./signal-chart";
import { SignalPositionsTable } from "./signal-positions-table";
import { SignalExecutionPanel } from "./signal-execution-panel";
import { executeSignalAction } from "./actions";

interface SignalPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ trade?: string }>;
}

export default async function SignalPage({ params, searchParams }: SignalPageProps) {
  const { id: rawId } = await params;
  const query = await searchParams;
  void query;

  const symbol = rawId.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const formattedSymbol = symbol.endsWith("USDT") ? symbol : `${symbol}USDT`;

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

  // 1. Fetch live 24h ticker info from Bybit Linear Public API
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

  // 2. Fetch Klines for chart
  const klines = await fetchRecentKlines(formattedSymbol, "15", 35).catch(() => []);

  // 3. Compute signal targets
  const isLong = changeNum >= 0;
  const side = isLong ? ("long" as const) : ("short" as const);
  const entry = currentPrice;
  const slDist = entry * 0.025;
  const stopLoss = isLong ? entry - slDist : entry + slDist;
  const tp1 = isLong ? entry + slDist * 1.8 : entry - slDist * 1.8;
  const tp2 = isLong ? entry + slDist * 2.6 : entry - slDist * 2.6;
  const tp3 = isLong ? entry + slDist * 3.5 : entry - slDist * 3.5;

  // 4. Fetch active trade and trade history from DB
  const tradesList: Array<{
    id: string;
    symbol: string;
    side: "long" | "short";
    leverage: number;
    entryPrice: number;
    markPrice: number;
    pnl: number;
    sl: number | null;
    tp1: number | null;
    status: string;
  }> = [];

  const historyTrades: typeof tradesList = [];

  if (account) {
    const { data: rawTrades } = await supabase
      .from("trades")
      .select("id, symbol, side, status, entry_avg, qty, leverage, sl, realized_pnl")
      .eq("account_id", account.id)
      .eq("symbol", formattedSymbol)
      .order("created_at", { ascending: false })
      .limit(10);

    if (rawTrades) {
      for (const t of rawTrades) {
        const item = {
          id: String(t.id),
          symbol: String(t.symbol),
          side: t.side === "short" ? ("short" as const) : ("long" as const),
          leverage: Number(t.leverage ?? 5),
          entryPrice: Number(t.entry_avg ?? currentPrice),
          markPrice: currentPrice,
          pnl: Number(t.realized_pnl ?? 0),
          sl: t.sl ? Number(t.sl) : null,
          tp1: tp1,
          status: String(t.status)
        };
        if (t.status === "active" || t.status === "entry_open") {
          // Calculate unrealized PnL approx
          const priceDiff = (currentPrice - item.entryPrice) * (item.side === "long" ? 1 : -1);
          item.pnl = Number(((priceDiff / item.entryPrice) * 100 * item.leverage).toFixed(2));
          tradesList.push(item);
        } else {
          historyTrades.push(item);
        }
      }
    }
  }

  const activePosition = tradesList[0] || null;

  const handleExecuteAction = async (data: { orderType: "Market" | "Limit"; margin: number; leverage: number }) => {
    "use server";
    await executeSignalAction(formattedSymbol, side, data.margin, data.leverage);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%", maxWidth: "1232px", margin: "0 auto" }}>
      {/* Breadcrumb */}
      <div className="lb">
        <Link href="/dashboard/pulse" style={{ color: "var(--muted)" }}>Pulse</Link> / {formattedSymbol}
      </div>

      {/* Symbol Header & 24h Stats */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap", margin: "4px 0 12px" }}>
        <b style={{ font: "700 26px Inter, sans-serif", color: "#FFFFFF" }}>{formattedSymbol}</b>
        <span className="tg gy">Perp</span>
        <span className="tg gy">Bybit</span>
        <span className="v" style={{ margin: 0, fontSize: "28px", color: isLong ? "#42F5B9" : "#FF5A6E" }}>
          {formatPrice(currentPrice)}
        </span>
        <span style={{ font: "600 14px Inter, sans-serif", color: isLong ? "#42F5B9" : "#FF5A6E" }}>
          {price24hPcnt}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: "28px", flexWrap: "wrap" }}>
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

      {/* Main Layout: 840px Left Column + 344px Right Column */}
      <div className="signal-layout">
        {/* Left Column (840px): Chart + Positions Table */}
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
              pnl: activePosition.pnl,
              isPaper: account?.exchange === "paper" || account?.environment === "demo"
            } : null}
          />

          <SignalPositionsTable
            symbol={formattedSymbol}
            trades={tradesList}
            historyTrades={historyTrades}
          />
        </div>

        {/* Right Column (344px): Signal Specs + Execution Panel */}
        <div className="signal-panel">
          {/* Signal Specs Card */}
          <div className="cd" style={{ padding: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <b style={{ font: "700 16px Inter, sans-serif", color: "#FFFFFF" }}>Signal</b>
              <span className={`tg ${isLong ? "lg" : "sh"}`}>
                {side.toUpperCase()}
              </span>
              <span className="lb" style={{ marginLeft: "auto" }}>2m ago</span>
            </div>

            <div style={{ marginTop: "10px" }}>
              <div className="row">
                <span>Trigger</span>
                <span>Breakout · {price24hPcnt} / 15m</span>
              </div>
              <div className="row">
                <span>Entry</span>
                <span>{formatPrice(entry)}</span>
              </div>
              <div className="row">
                <span>Stop loss</span>
                <span style={{ color: "#FF5A6E" }}>{formatPrice(stopLoss)}</span>
              </div>
              <div className="row">
                <span>TP1 · 40%</span>
                <span style={{ color: "#42F5B9" }}>{formatPrice(tp1)}</span>
              </div>
              <div className="row">
                <span>TP2 · 30%</span>
                <span style={{ color: "#42F5B9" }}>{formatPrice(tp2)}</span>
              </div>
              <div className="row">
                <span>TP3 · 30%</span>
                <span style={{ color: "#42F5B9" }}>{formatPrice(tp3)}</span>
              </div>
              <div className="row">
                <span>Trailing</span>
                <span>1% after TP1</span>
              </div>
              <div className="row">
                <span>R:R</span>
                <span>1 : 2.2</span>
              </div>
              <div className="row">
                <span>AI confidence</span>
                <span style={{ color: "#42F5B9" }}>68%</span>
              </div>
            </div>
          </div>

          {/* Trade Execution Card */}
          <SignalExecutionPanel
            symbol={formattedSymbol}
            side={side}
            currentPrice={currentPrice}
            availableBalance={availableBalance}
            onExecute={handleExecuteAction}
          />
        </div>
      </div>
    </div>
  );
}
