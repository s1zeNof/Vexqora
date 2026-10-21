"use server";

import { createBybitClient, decryptSecret, encryptSecret } from "@crypto-bot/exchange";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const accountSchema = z.object({
  label: z.string().trim().min(1).max(60),
  environment: z.enum(["live", "demo"]),
  apiKey: z.string().trim().min(8).max(200),
  apiSecret: z.string().trim().min(8).max(200)
});

function masterKey(): string {
  const value = process.env.ENCRYPTION_MASTER_KEY;
  if (!value) throw new Error("ENCRYPTION_MASTER_KEY is missing");
  return value;
}

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function authenticatedContext() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

export async function connectBybitAccount(formData: FormData) {
  const parsed = accountSchema.safeParse({
    label: textField(formData, "label"),
    environment: textField(formData, "environment"),
    apiKey: textField(formData, "apiKey"),
    apiSecret: textField(formData, "apiSecret")
  });
  if (!parsed.success) redirect(`/dashboard/accounts?error=${encodeURIComponent("Invalid account details")}`);

  const { supabase, user } = await authenticatedContext();
  const client = createBybitClient(parsed.data);
  try {
    await client.getBalance();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bybit verification failed";
    redirect(`/dashboard/accounts?error=${encodeURIComponent(message)}`);
  }

  const { count } = await supabase
    .from("exchange_accounts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  const key = masterKey();
  const { data: account, error } = await supabase.from("exchange_accounts").insert({
    user_id: user.id,
    exchange: "bybit",
    environment: parsed.data.environment,
    label: parsed.data.label,
    api_key_enc: encryptSecret(parsed.data.apiKey, key),
    api_secret_enc: encryptSecret(parsed.data.apiSecret, key),
    is_active: count === 0
  }).select("id").single();
  if (error) redirect(`/dashboard/accounts?error=${encodeURIComponent(error.message)}`);

  const { error: riskError } = await supabase.from("risk_settings").insert({ account_id: account.id });
  if (riskError) redirect(`/dashboard/accounts?error=${encodeURIComponent(riskError.message)}`);
  revalidatePath("/dashboard");
  redirect("/dashboard/accounts?connected=1");
}

export async function activateAccount(formData: FormData) {
  const accountId = textField(formData, "accountId");
  const { supabase, user } = await authenticatedContext();
  const { error: clearError } = await supabase.from("exchange_accounts").update({ is_active: false }).eq("user_id", user.id);
  if (clearError) throw new Error(clearError.message);
  const { error } = await supabase.from("exchange_accounts").update({ is_active: true }).eq("id", accountId).eq("user_id", user.id);
  if (error) throw new Error(error.message);
  await supabase.from("audit_log").insert({ user_id: user.id, account_id: accountId, action: "account.activated" });
  revalidatePath("/dashboard");
}

export async function requestDemoFunds(formData: FormData) {
  const accountId = textField(formData, "accountId");
  const amount = Number(textField(formData, "amount"));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) throw new Error("Demo amount must be between 0 and 100000 USDT");
  const { supabase } = await authenticatedContext();
  const { data, error } = await supabase.from("exchange_accounts")
    .select("environment, api_key_enc, api_secret_enc")
    .eq("id", accountId)
    .single();
  if (error || !data) throw new Error("Account not found");
  const account = z.object({
    environment: z.string(),
    api_key_enc: z.string(),
    api_secret_enc: z.string()
  }).parse(data);
  if (account.environment !== "demo") throw new Error("Demo funding is unavailable for live accounts");
  const key = masterKey();
  const client = createBybitClient({
    environment: "demo",
    apiKey: decryptSecret(account.api_key_enc, key),
    apiSecret: decryptSecret(account.api_secret_enc, key)
  });
  await client.requestDemoFunds?.(amount);
  revalidatePath("/dashboard");
}

export async function ensurePaperAccount() {
  const { supabase, user } = await authenticatedContext();
  const { error } = await supabase.rpc("ensure_user_workspace", { target_user_id: user.id });
  if (error) redirect(`/dashboard/accounts?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/accounts?paper=1");
}

export async function topUpPaperBalance(formData: FormData) {
  const accountId = textField(formData, "accountId");
  const amount = Number(textField(formData, "amount"));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000) throw new Error("Paper amount must be between 0 and 100000 USDT");
  const { supabase } = await authenticatedContext();
  const { error } = await supabase.rpc("top_up_paper_balance", { target_account_id: accountId, amount });
  if (error) redirect(`/dashboard/accounts?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/accounts?toppedUp=1");
}

export async function updateProfile(formData: FormData) {
  const displayName = textField(formData, "displayName").trim();
  if (!displayName || displayName.length > 80) throw new Error("Display name must be between 1 and 80 characters");
  const { supabase, user } = await authenticatedContext();
  const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/profile?saved=1");
}

