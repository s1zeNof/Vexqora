import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { CopilotInterface } from "./copilot-interface";

export const metadata = {
  title: "AI Copilot · Vexqora Trade",
  description: "Розумний мультисценарний аналітик та оптимізатор точок входу криптовалютних ф'ючерсів"
};

const copilotAccountSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  exchange: z.string(),
  environment: z.string(),
  paper_balance: z.coerce.number().nullable()
});

export default async function CopilotPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: accountData } = await supabase
    .from("exchange_accounts")
    .select("id, label, exchange, environment, paper_balance")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const parsedAccount = accountData ? copilotAccountSchema.safeParse(accountData).data ?? null : null;
  const activeBalance = Number(parsedAccount?.paper_balance ?? 0);
  const activeLabel = parsedAccount?.label ?? "Vexqora Paper";
  const isPaper = parsedAccount?.exchange === "paper" || parsedAccount?.environment === "demo";

  return (
    <div style={{ padding: "8px 0 32px 0" }}>
      <CopilotInterface
        initialAvailableBalance={activeBalance}
        activeAccountLabel={activeLabel}
        isPaper={isPaper}
      />
    </div>
  );
}
