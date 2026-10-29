import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { ScalpingWorkbench, type ScalpingSetup } from "./scalping-workbench";

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value !== null && typeof value === "object" ? value as JsonRecord : {};
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

export default async function ScalpingPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: account } = await supabase.from("exchange_accounts")
    .select("id, label, exchange, environment, paper_balance")
    .eq("user_id", user.id).eq("is_active", true).limit(1).maybeSingle();
  if (!account) redirect("/dashboard/accounts");

  const since = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
  const { data: rows } = await supabase.from("signals")
    .select("id, parsed, status, source, created_at, expires_at")
    .eq("account_id", account.id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(40);

  const setups: ScalpingSetup[] = ((rows ?? []) as unknown[]).flatMap((rawRow) => {
    const row = record(rawRow);
    const parsed = record(row.parsed);
    const signal = record(parsed.signal);
    const opportunity = record(parsed.opportunity);
    const evidence = record(parsed.executionEvidence ?? opportunity.executionEvidence);
    const targets = Array.isArray(signal.takeProfits) ? signal.takeProfits : [];
    const firstTarget = record(targets[0]);
    const symbol = typeof signal.symbol === "string" ? signal.symbol : typeof opportunity.symbol === "string" ? opportunity.symbol : null;
    const side = signal.side === "long" || signal.side === "short" ? signal.side : opportunity.side === "long" || opportunity.side === "short" ? opportunity.side : null;
    const entry = number(parsed.entryPrice) ?? number(opportunity.entryPrice);
    const stopLoss = number(signal.stopLoss) ?? number(opportunity.stopLoss);
    const tp1 = number(firstTarget.price) ?? (Array.isArray(opportunity.takeProfits) ? number(record(opportunity.takeProfits[0]).price) : null);
    if (!symbol || !side || entry === null || stopLoss === null || tp1 === null) return [];
    const expiresAt = typeof row.expires_at === "string" ? row.expires_at : null;
    const id = typeof row.id === "string" ? row.id : null;
    const createdAt = typeof row.created_at === "string" ? row.created_at : null;
    if (!id || !createdAt) return [];
    const expiresAtMs = number(evidence.expiresAtMs) ?? (expiresAt ? new Date(expiresAt).getTime() : null);
    return [{
      id,
      symbol,
      side,
      entry,
      stopLoss,
      tp1,
      strategy: typeof opportunity.strategy === "string" ? opportunity.strategy : null,
      rationale: typeof opportunity.rationale === "string" ? opportunity.rationale : null,
      decision: opportunity.decision === "TRADE" || opportunity.decision === "WAIT_FOR_CONFIRMATION" ? opportunity.decision : "REVIEW",
      regime: typeof evidence.structureTrend === "string" ? evidence.structureTrend : null,
      expiresAtMs,
      generatedAt: createdAt,
      source: typeof row.source === "string" ? row.source : "unknown",
      probability: number(evidence.winProbabilityPct),
      probabilityCalibrated: evidence.mlEvidence !== undefined && record(evidence.mlEvidence).status === "PASS"
    }];
  });

  const accountRecord = record(account);
  const accountLabel = typeof accountRecord.label === "string" ? accountRecord.label : "Active account";
  const paperBalance = number(accountRecord.paper_balance) ?? 10;
  return <ScalpingWorkbench initialSetups={setups} accountLabel={accountLabel} initialDeposit={paperBalance} />;
}
