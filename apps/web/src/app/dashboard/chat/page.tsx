import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { SignalComposer } from "./signal-composer";
import { z } from "zod";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ error?: string; queued?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const query = await searchParams;
  const { data: active } = await supabase.from("exchange_accounts").select("id, label, environment").eq("is_active", true).single();
  const account = z.object({ id: z.string(), label: z.string(), environment: z.string() }).nullable().parse(active);
  const { data } = account ? await supabase.from("chat_messages").select("id, role, kind, content, created_at")
    .eq("account_id", account.id).order("created_at", { ascending: false }).limit(30) : { data: [] };
  const messages = z.array(z.object({
    id: z.string(), role: z.string(), kind: z.string(), content: z.string(), created_at: z.string()
  })).parse(data ?? []);

  return (
    <main className="shell chat-shell">
      <nav><Link href="/dashboard">← Accounts</Link></nav>
      <p className="eyebrow">Signal workspace</p>
      <h1>Trade chat</h1>
      {account ? <p className="lead">Active account: {account.label} <span className={`badge ${account.environment}`}>{account.environment}</span></p> : <p className="error">Connect an exchange account before creating a preview.</p>}
      {query.error ? <p className="error">{query.error}</p> : null}
      {query.queued ? <p className="success">Signal queued for execution.</p> : null}
      {account ? <SignalComposer /> : null}
      <section className="message-list">
        {messages.map((message) => <article className={`message ${message.role}`} key={message.id}><small>{message.kind}</small><p>{message.content}</p></article>)}
      </section>
    </main>
  );
}

