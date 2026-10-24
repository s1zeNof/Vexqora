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
  status: string;
  exit_reason: string | null;
  exit_price: number | null;
  realized_pnl: number | null;
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
      .select("id, account_id, status, exit_reason, exit_price, realized_pnl, exchange_accounts!inner(user_id)")
      .eq("id", tradeId)
      .maybeSingle();

    const trade = rawTrade as DbTradeRecord | null;

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

    const res = await processPaperTradeTick(supabase, tradeId, currentPrice);
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
