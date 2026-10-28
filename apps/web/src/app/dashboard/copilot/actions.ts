"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { executeSignalAction } from "../signal/[id]/actions";

export async function executeCopilotSetupAction(scenario: {
  symbol: string;
  side: "long" | "short";
  orderType: "Limit" | "Market";
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  leverage: number;
  allocatedMarginUsdt: number;
}): Promise<{ success: boolean; message: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const effectiveMargin = Math.max(0.1, Number(scenario.allocatedMarginUsdt.toFixed(2)));

  await executeSignalAction(
    scenario.symbol,
    scenario.side,
    effectiveMargin,
    scenario.leverage,
    null,
    {
      orderType: scenario.orderType,
      limitPrice: scenario.orderType === "Limit" ? scenario.entryPrice : undefined,
      adaptedLevels: {
        stopLoss: scenario.stopLoss,
        tp1: scenario.tp1,
        tp2: scenario.tp2,
        tp3: scenario.tp3
      }
    }
  );

  revalidatePath("/dashboard/positions");
  revalidatePath("/dashboard/signals");
  revalidatePath(`/dashboard/signal/${scenario.symbol}`);
  revalidatePath("/dashboard/copilot");

  return {
    success: true,
    message: `Позицію по ${scenario.symbol} успішно відкрито на суму $${effectiveMargin} USDT (${scenario.leverage}x)!`
  };
}
