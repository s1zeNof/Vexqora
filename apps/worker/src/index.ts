import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Signal } from "@crypto-bot/shared";
import { getWorkerConfig } from "./config";
import { logger } from "./logger";
import { reconcileOnStartup } from "./reconciler";
import { processJob, type ExecutionJobData } from "./runner";

interface JobRow {
  id: string;
  account_id: string;
  signal_id: string;
  attempt_count: number;
}

async function claimNextJob(supabase: SupabaseClient): Promise<ExecutionJobData | null> {
  // 1. Try RPC claim function (FOR UPDATE SKIP LOCKED)
  try {
    const rpcRes = await supabase.rpc("claim_execution_job", { p_worker_id: "worker-node-1" });
    if (!rpcRes.error && Array.isArray(rpcRes.data) && rpcRes.data.length > 0) {
      const jobList = rpcRes.data as ExecutionJobData[];
      return jobList[0] ?? null;
    }
  } catch {
    // If RPC not applied yet, use atomic fallback query
  }

  // 2. Fallback query with status = 'queued'
  const selectRes = await supabase
    .from("execution_jobs")
    .select("id, account_id, signal_id, attempt_count")
    .eq("status", "queued")
    .lte("available_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(1);

  if (selectRes.error || !selectRes.data || (selectRes.data as unknown as JobRow[]).length === 0) {
    return null;
  }

  const jobs = selectRes.data as unknown as JobRow[];
  const jobSummary = jobs[0];
  if (!jobSummary) return null;

  // Optimistic lock
  const updateRes = await supabase
    .from("execution_jobs")
    .update({
      status: "processing",
      locked_at: new Date().toISOString(),
      attempt_count: jobSummary.attempt_count + 1
    })
    .eq("id", jobSummary.id)
    .eq("status", "queued")
    .select("id, account_id, signal_id, attempt_count")
    .single();

  if (updateRes.error || !updateRes.data) {
    return null; // Another worker claimed it
  }

  const lockedJob = updateRes.data;

  // Fetch signal and exchange account
  const [signalRes, accountRes] = await Promise.all([
    supabase.from("signals").select("raw_text, parsed").eq("id", lockedJob.signal_id).single(),
    supabase.from("exchange_accounts").select("exchange, environment, api_key_enc, api_secret_enc").eq("id", lockedJob.account_id).single()
  ]);

  if (signalRes.error || accountRes.error || !signalRes.data || !accountRes.data) {
    await supabase.from("execution_jobs").update({
      status: "failed",
      last_error: "Signal or exchange account record missing"
    }).eq("id", lockedJob.id);
    return null;
  }

  const signalData = signalRes.data as Record<string, unknown>;
  const accountData = accountRes.data as Record<string, unknown>;

  return {
    job_id: String(lockedJob.id),
    account_id: String(lockedJob.account_id),
    signal_id: String(lockedJob.signal_id),
    attempt_count: Number(lockedJob.attempt_count),
    signal_parsed: signalData.parsed as Signal,
    signal_raw: typeof signalData.raw_text === "string" ? signalData.raw_text : "",
    exchange_kind: String(accountData.exchange),
    exchange_env: accountData.environment as "live" | "demo",
    api_key_enc: String(accountData.api_key_enc),
    api_secret_enc: String(accountData.api_secret_enc)
  };
}

async function startWorker() {
  const config = getWorkerConfig();
  logger.info("Initializing Vexqora Execution Worker...");

  const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // Run startup reconciliation
  await reconcileOnStartup(supabase, config.masterKey);

  logger.info({ pollIntervalMs: config.pollIntervalMs }, "Worker queue consumer active. Waiting for execution jobs...");

  let isRunning = true;

  const shutdown = () => {
    logger.info("Shutdown signal received. Stopping worker loop...");
    isRunning = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Subscribe to Realtime notifications for immediate trigger
  const channel = supabase
    .channel("execution_jobs_watcher")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "execution_jobs" }, () => {
      logger.info("New execution job detected via Realtime publication");
      void runJobCycle(supabase, config);
    })
    .subscribe();

  async function runJobCycle(client: SupabaseClient, cfg: typeof config) {
    try {
      const job = await claimNextJob(client);
      if (job) {
        try {
          await processJob(client, job, cfg.masterKey, cfg.discordWebhookUrl, cfg.telegramBotToken);

          // Mark job completed
          await client.from("execution_jobs").update({
            status: "completed",
            locked_at: null,
            last_error: null
          }).eq("id", job.job_id);

        } catch (execError) {
          const message = execError instanceof Error ? execError.message : String(execError);
          logger.error({ jobId: job.job_id, error: message }, "Job execution failed");

          await client.from("execution_jobs").update({
            status: "failed",
            locked_at: null,
            last_error: message
          }).eq("id", job.job_id);

          await client.from("chat_messages").insert({
            account_id: job.account_id,
            role: "system",
            kind: "error",
            content: `Execution error for ${job.signal_parsed?.symbol ?? "signal"}: ${message}`,
            payload: { jobId: job.job_id, error: message }
          });
        }
      }
    } catch (cycleError) {
      logger.error({ error: cycleError }, "Error in job processing cycle");
    }
  }

  // Main polling loop
  while (isRunning) {
    await runJobCycle(supabase, config);
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }

  await supabase.removeChannel(channel);
  logger.info("Vexqora Worker stopped cleanly.");
}

startWorker().catch((err) => {
  logger.fatal({ err }, "Fatal error in worker startup");
  process.exit(1);
});
