import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env", "../../.env.local", "../../.env"] });

export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  masterKey: string;
  telegramBotToken: string | undefined;
  discordWebhookUrl: string | undefined;
  pollIntervalMs: number;
}

export function getWorkerConfig(): WorkerConfig {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dhmqambeoglrmdbtjrrt.supabase.co";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const masterKey = process.env.ENCRYPTION_MASTER_KEY;

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for execution worker");
  }
  if (!masterKey) {
    throw new Error("ENCRYPTION_MASTER_KEY is required for execution worker");
  }

  return {
    supabaseUrl,
    serviceRoleKey,
    masterKey,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? undefined,
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL ?? undefined,
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 2000
  };
}
