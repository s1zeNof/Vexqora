"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "../../lib/supabase/server";

function readTextField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function signIn(formData: FormData) {
  const email = readTextField(formData, "email");
  const password = readTextField(formData, "password");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/dashboard");
}

export async function signUp(formData: FormData) {
  const email = readTextField(formData, "email");
  const password = readTextField(formData, "password");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/dashboard");
}

export async function signInWithGoogle() {
  const supabase = await createSupabaseServerClient();
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "localhost:3000";
  const proto = headersList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback`
    }
  });

  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  if (data?.url) redirect(data.url);
}
