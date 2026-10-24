import type { TradeRow } from "@crypto-bot/shared";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { HistoryView } from "./history-view";

export default async function HistoryPage() {
  const supabase = await createSupabaseServerClient();
  const { data: active } = await supabase.from("exchange_accounts").select("id").eq("is_active", true).limit(1).maybeSingle();
  const closedTrades = (active
    ? (await supabase.from("trades").select("*").eq("account_id", active.id).order("opened_at", { ascending: false }).limit(500)).data
    : []) as TradeRow[] | null;

  return <HistoryView trades={closedTrades ?? []} />;
}

