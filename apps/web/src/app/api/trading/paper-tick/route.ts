import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { processPaperTradeTick } from "../../../../lib/paper-service";

const tickSchema = z.object({
  tradeId: z.string().uuid(),
  currentPrice: z.number().positive()
});

interface DbTradeRecord {
  id: string;
  account_id: string;
  symbol: string;
  status: string;
  exit_reason: string | null;
  exit_price: number | null;
  realized_pnl: number | null;
}

interface VerifiedTicker {
  lastPrice: number;
  high24h: number;
  low24h: number;
}

async function getVerifiedExchangeTicker(symbol: string): Promise<VerifiedTicker | null> {
  try {
    const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${encodeURIComponent(symbol)}`, {
      cache: "no-store",
      headers: { "User-Agent": "Vexqora-Price-Verifier", "Accept": "application/json" }
    });
    if (res.ok) {
      const json = await res.json() as {
        result?: {
          list?: Array<{
            lastPrice?: string;
            highPrice24h?: string;
            lowPrice24h?: string;
          }>;
        };
      };
      const item = json.result?.list?.[0];
      const last = Number(item?.lastPrice ?? 0);
      const high = Number(item?.highPrice24h ?? 0);
      const low = Number(item?.lowPrice24h ?? 0);
      if (last > 0) {
        return {
          lastPrice: last,
          high24h: high > 0 ? high : last * 1.05,
          low24h: low > 0 ? low : last * 0.95
        };
      }
    }
  } catch {
    // fallback
  }

  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(symbol)}`, {
      cache: "no-store"
    });
    if (res.ok) {
      const json = await res.json() as {
        lastPrice?: string;
        highPrice?: string;
        lowPrice?: string;
      };
      const last = Number(json.lastPrice ?? 0);
      const high = Number(json.highPrice ?? 0);
      const low = Number(json.lowPrice ?? 0);
      if (last > 0) {
        return {
          lastPrice: last,
          high24h: high > 0 ? high : last * 1.05,
          low24h: low > 0 ? low : last * 0.95
        };
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json() as unknown;
    const parsed = tickSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request payload", details: parsed.error.issues }, { status: 400 });
    }

    const { tradeId, currentPrice } = parsed.data;

    // Verify ownership: user owns the account associated with this trade
    const { data: rawTrade } = await supabase
      .from("trades")
      .select("id, account_id, symbol, status, entry_avg, exit_reason, exit_price, realized_pnl, exchange_accounts!inner(user_id)")
      .eq("id", tradeId)
      .maybeSingle();

    interface DbTradeWithEntry extends DbTradeRecord {
      entry_avg: number | null;
    }

    const trade = rawTrade as DbTradeWithEntry | null;

    if (!trade) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }

    // If trade was already closed by the background worker, inform client immediately
    if (trade.status === "closed") {
      return NextResponse.json({
        success: true,
        isClosed: true,
        tradeStatus: "closed",
        actionsCount: 0,
        exitReason: trade.exit_reason,
        exitPrice: trade.exit_price,
        realizedPnl: trade.realized_pnl
      });
    }

    // Server-side market verification: reject anomalous client ticks (stale SSR cache, lag spikes, wrong-symbol prices)
    let effectivePrice = currentPrice;
    const ticker = await getVerifiedExchangeTicker(trade.symbol);

    if (ticker) {
      const minAllowed = ticker.low24h * 0.98;
      const maxAllowed = ticker.high24h * 1.02;

      // If client price violates 24h high/low bounds of the exchange ticker, reject client price
      if (currentPrice < minAllowed || currentPrice > maxAllowed) {
        effectivePrice = ticker.lastPrice;
      } else {
        const drift = Math.abs(currentPrice - ticker.lastPrice) / ticker.lastPrice;
        // If client price deviates > 2% from live exchange ticker, enforce verified exchange price
        if (drift > 0.02) {
          effectivePrice = ticker.lastPrice;
        }
      }
    } else {
      // Exchange ticker unreachable: safeguard active position from wild client spikes
      const entryPrice = Number(trade.entry_avg ?? 0);
      if (entryPrice > 0) {
        const entryDrift = Math.abs(currentPrice - entryPrice) / entryPrice;
        // If price deviates > 7% without verified exchange ticker confirmation, do not execute
        if (entryDrift > 0.07) {
          return NextResponse.json({
            success: true,
            evaluated: false,
            actionsCount: 0,
            message: "Tick deferred: unverified price deviation > 7% from entry"
          });
        }
      }
    }

    const res = await processPaperTradeTick(supabase, tradeId, effectivePrice);
    const isClosed = res ? res.updatedTrade.status === "closed" : false;

    return NextResponse.json({
      success: true,
      isClosed,
      tradeStatus: res ? res.updatedTrade.status : trade.status,
      evaluated: Boolean(res),
      actionsCount: res?.actions.length ?? 0,
      totalRealizedPnlDelta: res?.totalRealizedPnlDelta ?? 0,
      updatedTrade: res?.updatedTrade ?? null
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
