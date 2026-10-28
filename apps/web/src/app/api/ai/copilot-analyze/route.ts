import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { analyzePairWithCopilot } from "@crypto-bot/trading";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as { query?: string; customBalance?: number };
    const query = body.query?.trim();

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    // Retrieve active exchange account for user to check actual paper balance
    const { data: rawAccount } = await supabase
      .from("exchange_accounts")
      .select("id, exchange, paper_balance")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const activeBalance = Number(rawAccount?.paper_balance ?? 0);
    const balanceToUse = typeof body.customBalance === "number" && body.customBalance > 0
      ? body.customBalance
      : (activeBalance > 0 ? activeBalance : 15);

    const result = await analyzePairWithCopilot({
      query,
      userBalance: balanceToUse,
      openRouterApiKey: process.env.OPENROUTER_API_KEY,
      openRouterModel: process.env.OPENROUTER_MODEL
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to analyze pair with copilot:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
