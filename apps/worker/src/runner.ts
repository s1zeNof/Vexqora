import { createBybitClient, createPaperExchangeClient, decryptSecret } from "@crypto-bot/exchange";
import type { RiskSettingsRow, Signal } from "@crypto-bot/shared";
import { createTradePreview, protectFilledPosition, submitEntry, verifyExecutionGates, type TradePreview } from "@crypto-bot/trading";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";
import { sendDiscordAlert } from "./notifications";

export interface ExecutionJobData {
  job_id: string;
  account_id: string;
  signal_id: string;
  attempt_count: number;
  signal_parsed: Signal;
  signal_raw: string;
  exchange_kind: string;
  exchange_env: "live" | "demo";
  api_key_enc: string | null;
  api_secret_enc: string | null;
  paper_balance?: number | null;
}

export async function processJob(
  supabase: SupabaseClient,
  job: ExecutionJobData,
  masterKey: string,
  discordWebhook?: string,
  _telegramBotToken?: string
): Promise<void> {
  void _telegramBotToken;
  const { account_id, signal_id, signal_parsed: signal } = job;
  logger.info({ jobId: job.job_id, symbol: signal.symbol, side: signal.side }, "Starting job execution");

  // 1. Fetch risk settings for this account
  const riskRes = await supabase
    .from("risk_settings")
    .select("*")
    .eq("account_id", account_id)
    .single();

  if (riskRes.error || !riskRes.data) {
    throw new Error(`Risk settings not found for account ${account_id}`);
  }

  const riskSettings = riskRes.data as unknown as RiskSettingsRow;

  // Check Kill Switch
  if (riskSettings.kill_switch) {
    throw new Error("Execution blocked: Emergency Kill Switch is ACTIVE for this account");
  }

  // Check open positions limit
  const openPosRes = await supabase
    .from("trades")
    .select("id", { count: "exact", head: true })
    .eq("account_id", account_id)
    .eq("status", "active");

  const openPositionsCount = openPosRes.count ?? 0;

  if (openPositionsCount >= riskSettings.max_open_positions) {
    throw new Error(`Open positions limit (${riskSettings.max_open_positions}) reached`);
  }

  // 2. Decrypt exchange credentials & create exchange client
  const client = job.exchange_kind === "paper"
    ? createPaperExchangeClient({ balance: job.paper_balance ?? 0 })
    : (() => {
        if (!job.api_key_enc || !job.api_secret_enc) throw new Error("Exchange credentials are missing");
        return createBybitClient({ apiKey: decryptSecret(job.api_key_enc, masterKey), apiSecret: decryptSecret(job.api_secret_enc, masterKey), environment: job.exchange_env });
      })();

  // 3. Fetch latest market data & balance
  const [balance, instrument, ticker] = await Promise.all([
    client.getBalance(),
    client.getInstrument(signal.symbol),
    client.getTicker(signal.symbol)
  ]);

  if (balance.available <= 0) {
    throw new Error(`Insufficient available balance (${balance.available} USDT)`);
  }

  // 3b. Compute realized daily PnL (since UTC midnight) to enforce max_daily_loss_pct
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const closedTodayRes = await supabase
    .from("trades")
    .select("realized_pnl")
    .eq("account_id", account_id)
    .eq("status", "closed")
    .gte("closed_at", todayStart.toISOString());

  const dailyPnl = (closedTodayRes.data ?? []).reduce(
    (sum: number, t: { realized_pnl: number | string | null }) => sum + (Number(t.realized_pnl) || 0),
    0
  );

  // 4. Calculate validated trade preview
  const preview: TradePreview = createTradePreview(
    signal,
    instrument,
    {
      riskPerTradePct: Number(riskSettings.risk_per_trade_pct),
      maxLeverage: Number(riskSettings.max_leverage),
      maxOpenPositions: Number(riskSettings.max_open_positions),
      maxDailyLossPct: Number(riskSettings.max_daily_loss_pct),
      ...(riskSettings.allowed_symbols ? { allowedSymbols: riskSettings.allowed_symbols } : {}),
      killSwitch: Boolean(riskSettings.kill_switch)
    },
    {
      balance: balance.available,
      marketPrice: ticker.lastPrice,
      openPositions: openPositionsCount,
      dailyPnl
    }
  );

  // 4b. Enforce 4-Gate Decision Ensemble verification on backend execution path
  const gateCheck = verifyExecutionGates({
    symbol: signal.symbol,
    side: signal.side,
    entryPrice: preview.entryPrice,
    stopLoss: signal.stopLoss,
    tp1: signal.takeProfits[0]?.price ?? preview.entryPrice,
    riskReward: preview.weightedRewardRisk,
    killSwitchActive: Boolean(riskSettings.kill_switch)
  });

  if (!gateCheck.passed) {
    throw new Error(`Order execution blocked by Decision Ensemble Gate: ${gateCheck.rejectionReasons.join("; ")}`);
  }

  // 5. Persist trade record
  const tradeInsertRes = await supabase
    .from("trades")
    .insert({
      account_id,
      signal_id,
      symbol: signal.symbol,
      side: signal.side,
      status: "pending",
      entry_avg: preview.entryPrice,
      qty: preview.qty,
      leverage: preview.leverage,
      sl: signal.stopLoss,
      trailing_stop: signal.trailingStop ?? null
    })
    .select("id")
    .single();

  if (tradeInsertRes.error || !tradeInsertRes.data) {
    throw new Error(`Failed to persist trade: ${tradeInsertRes.error?.message}`);
  }

  const tradeData = tradeInsertRes.data as Record<string, unknown>;
  const tradeId = String(tradeData.id);

  // 6. Submit Entry Order
  logger.info({ tradeId, symbol: signal.symbol, qty: preview.qty, exchange: job.exchange_kind }, "Submitting entry order");
  const entryResult = await submitEntry(client, preview, tradeId);

  // Persist entry order
  await supabase.from("orders").insert({
    trade_id: tradeId,
    exchange_order_id: entryResult.entryOrder.orderId,
    order_link_id: entryResult.entryOrder.orderLinkId ?? `entry-${tradeId}`,
    type: signal.entry.type === "market" ? "market" : "limit",
    side: signal.side === "long" ? "buy" : "sell",
    price: preview.entryPrice,
    qty: preview.qty,
    status: "submitted",
    reduce_only: false,
    raw: { preview, exchange: job.exchange_kind }
  });

  // Update trade status to entry_open
  await supabase.from("trades").update({ status: "entry_open" }).eq("id", tradeId);

  // Post chat event
  await supabase.from("chat_messages").insert({
    account_id,
    role: "system",
    kind: "order_event",
    content: `Entry order placed for ${signal.symbol}: ${signal.side.toUpperCase()} ${preview.qty} @ ${preview.entryPrice} (${signal.entry.type})`,
    payload: { tradeId, orderId: entryResult.entryOrder.orderId, preview }
  });

  // Notify Discord
  await sendDiscordAlert(discordWebhook, {
    title: `Order Submitted: ${signal.symbol} ${signal.side.toUpperCase()}`,
    description: `Entry order sent to ${job.exchange_kind} (${job.exchange_env.toUpperCase()}). Quantity: ${preview.qty}, Entry: ${preview.entryPrice}`,
    symbol: signal.symbol,
    side: signal.side,
    price: preview.entryPrice,
    qty: preview.qty
  });

  // 7. Handle Fill & Protection:
  let isFilled = signal.entry.type === "market";

  if (!isFilled) {
    const openOrders = await client.getOpenOrders(signal.symbol);
    const orderStillOpen = openOrders.some((o: { orderId: string }) => o.orderId === entryResult.entryOrder.orderId);
    if (!orderStillOpen) {
      isFilled = true;
    }
  }

  if (isFilled) {
    logger.info({ tradeId, symbol: signal.symbol }, "Entry filled; placing exchange-hosted SL and TP protection");

    // Call mode-agnostic protectFilledPosition
    const protection = await protectFilledPosition(client, preview, tradeId);

    // Save TP orders in database
    for (const [idx, tpOrder] of protection.takeProfitOrders.entries()) {
      const target = signal.takeProfits[idx];
      if (target) {
        await supabase.from("trade_targets").insert({
          trade_id: tradeId,
          idx: idx + 1,
          price: target.price,
          share_pct: target.sharePct,
          status: "open",
          order_id: tpOrder.orderId
        });

        await supabase.from("orders").insert({
          trade_id: tradeId,
          exchange_order_id: tpOrder.orderId,
          order_link_id: tpOrder.orderLinkId ?? `tp-${tradeId}-${idx + 1}`,
          type: "limit",
          side: signal.side === "long" ? "sell" : "buy",
          price: target.price,
          qty: (preview.qty * target.sharePct) / 100,
          status: "submitted",
          reduce_only: true
        });
      }
    }

    // Update trade to active with timestamp
    await supabase.from("trades").update({
      status: "active",
      opened_at: new Date().toISOString()
    }).eq("id", tradeId);

    // Chat message: Protection confirmed on exchange
    await supabase.from("chat_messages").insert({
      account_id,
      role: "system",
      kind: "order_event",
      content: `Entry filled at ${preview.entryPrice}. Stop Loss set at ${signal.stopLoss}. ${protection.takeProfitOrders.length} TP targets are active.`,
      payload: { tradeId, sl: signal.stopLoss, targetsCount: protection.takeProfitOrders.length }
    });

    await sendDiscordAlert(discordWebhook, {
      title: `Position Protected: ${signal.symbol}`,
      description: `Entry filled! Exchange Stop Loss at ${signal.stopLoss}. ${protection.takeProfitOrders.length} Take Profit orders placed.`,
      symbol: signal.symbol,
      side: signal.side,
      price: preview.entryPrice,
      qty: preview.qty
    });
  }

  logger.info({ jobId: job.job_id, tradeId }, "Execution job completed successfully");
}
