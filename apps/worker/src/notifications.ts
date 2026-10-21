import { logger } from "./logger.js";

export interface TradeNotification {
  title: string;
  description: string;
  color?: number | undefined;
  symbol: string;
  side: string;
  price?: number | undefined;
  qty?: number | undefined;
  pnl?: number | undefined;
}

export async function sendDiscordAlert(webhookUrl: string | undefined, notification: TradeNotification): Promise<void> {
  if (!webhookUrl) return;

  const color = notification.color ?? (notification.side === "long" ? 0x35f2d0 : 0xff4f9a);
  const body = {
    embeds: [
      {
        title: `⚡ Vexqora Trade · ${notification.title}`,
        description: notification.description,
        color,
        fields: [
          { name: "Symbol", value: notification.symbol, inline: true },
          { name: "Side", value: notification.side.toUpperCase(), inline: true },
          ...(notification.price ? [{ name: "Price", value: `${notification.price}`, inline: true }] : []),
          ...(notification.qty ? [{ name: "Quantity", value: `${notification.qty}`, inline: true }] : []),
          ...(notification.pnl !== undefined ? [{ name: "PnL", value: `${notification.pnl >= 0 ? "+" : ""}$${notification.pnl.toFixed(2)}`, inline: true }] : [])
        ],
        footer: { text: "Vexqora Intelligent Trade Execution" },
        timestamp: new Date().toISOString()
      }
    ]
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      logger.warn({ status: res.status, statusText: res.statusText }, "Discord webhook returned non-OK status");
    }
  } catch (err) {
    logger.error({ err }, "Failed to deliver Discord alert");
  }
}

export async function sendTelegramAlert(botToken: string | undefined, chatId: string | undefined, message: string): Promise<void> {
  if (!botToken || !chatId) return;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown"
      })
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "Telegram API returned non-OK response");
    }
  } catch (err) {
    logger.error({ err }, "Failed to deliver Telegram notification");
  }
}
