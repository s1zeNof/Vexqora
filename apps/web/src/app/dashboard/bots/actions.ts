"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export async function createPaperBot(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rawName = formData.get("name");
  const name = typeof rawName === "string" ? rawName.trim() : "";

  const rawDesc = formData.get("description");
  const description = typeof rawDesc === "string" && rawDesc.trim().length > 0 ? rawDesc.trim() : null;

  const rawCapital = formData.get("capital");
  const capital = typeof rawCapital === "string" ? Number(rawCapital) : Number(rawCapital ?? 0);

  const rawTarget = formData.get("target");
  const target = typeof rawTarget === "string" && rawTarget.length > 0 ? Number(rawTarget) : null;

  // Dynamic / Custom risk parameters
  const rawRisk = formData.get("risk_per_trade_pct");
  const rawDailyLoss = formData.get("max_daily_loss_pct");

  const riskPerTradePct = typeof rawRisk === "string" && rawRisk.length > 0
    ? Math.min(5, Math.max(0.1, Number(rawRisk)))
    : 1.0;

  const maxDailyLossPct = typeof rawDailyLoss === "string" && rawDailyLoss.length > 0
    ? Math.min(25, Math.max(0.1, Number(rawDailyLoss)))
    : 5.0;

  const maxDrawdownPct = 20.0;
  const maxTradesPerDay = 50;
  const maxLeverage = 3.0;
  const direction = "both"; // Autonomous AI decides Long/Short based on real-time market data

  const rawGoal = formData.get("goal_action");
  const goalAction = typeof rawGoal === "string" && ["stop", "pause", "continue"].includes(rawGoal)
    ? rawGoal
    : "pause";

  if (name.length < 2 || !Number.isFinite(capital) || capital <= 0) {
    redirect("/dashboard/bots?error=invalid");
  }

  const { data: account } = await supabase
    .from("exchange_accounts")
    .select("id,paper_balance")
    .eq("user_id", user.id)
    .eq("exchange", "paper")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!account || capital > Number(account.paper_balance ?? 0)) {
    redirect("/dashboard/bots?error=balance");
  }

  const { error } = await supabase.from("trading_bots").insert({
    user_id: user.id,
    account_id: account.id,
    name,
    description,
    mode: "paper",
    strategy: "scalping",
    allocated_capital: capital,
    current_balance: capital,
    target_balance: Number.isFinite(target) && target !== null && target > capital ? target : null,
    risk_per_trade_pct: riskPerTradePct,
    max_daily_loss_pct: maxDailyLossPct,
    max_drawdown_pct: maxDrawdownPct,
    max_trades_per_day: maxTradesPerDay,
    max_leverage: maxLeverage,
    direction,
    goal_action: goalAction,
  });

  if (error) {
    redirect("/dashboard/bots?error=database");
  }

  revalidatePath("/dashboard/bots");
  redirect("/dashboard/bots?created=1");
}

export async function setBotStatus(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rawId = formData.get("id");
  const id = typeof rawId === "string" ? rawId : "";

  const rawIntent = formData.get("intent");
  const intent = typeof rawIntent === "string" ? rawIntent : "stopped";
  const status = intent === "start" ? "running" : intent === "pause" ? "paused" : "stopped";

  await supabase
    .from("trading_bots")
    .update({
      status,
      autonomous_enabled: status === "running",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("mode", "paper");

  revalidatePath("/dashboard/bots");
}
