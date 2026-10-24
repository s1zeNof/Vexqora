import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { z } from "zod";
import { accountConnectionSchema, createAccountClient } from "../../lib/account-client";
import { TopNav } from "./top-nav";

import { TradeToastContainer } from "../../components/trade-toast";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  try {
    await supabase.rpc("ensure_user_workspace", { target_user_id: user.id });
  } catch {
    // Graceful fallback if workspace already initialized or RPC unavailable
  }

  const { data: active } = await supabase
    .from("exchange_accounts")
    .select("id, label, environment, exchange, api_key_enc, api_secret_enc, paper_balance")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const account = accountConnectionSchema.nullable().safeParse(active).data ?? null;
  const { data: rawProfile } = await supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
  const profile = z.object({ display_name: z.string().nullable() }).nullable().safeParse(rawProfile).data ?? null;
  let availableBalance: number | null = null;
  if (account) {
    try {
      availableBalance = (await createAccountClient(account).getBalance()).available;
    } catch {
      availableBalance = null;
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#000000" }}>
      <TopNav
        account={account}
        availableBalance={availableBalance}
        userEmail={user.email ?? ""}
        displayName={profile?.display_name ?? null}
      />
      <TradeToastContainer />
      <main className="main-shell">
        {children}
      </main>
    </div>
  );
}
