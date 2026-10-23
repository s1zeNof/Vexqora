import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { processPaperTradeTick } from "../../../../lib/paper-service";

const tickSchema = z.object({
  tradeId: z.string().uuid(),
  currentPrice: z.number().positive()
});

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
    const { data: trade } = await supabase
      .from("trades")
      .select("id, account_id, exchange_accounts!inner(user_id)")
      .eq("id", tradeId)
      .maybeSingle();

    if (!trade) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }

    const res = await processPaperTradeTick(supabase, tradeId, currentPrice);

    return NextResponse.json({
      success: true,
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
