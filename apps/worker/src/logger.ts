import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "apiKey",
      "apiSecret",
      "*.apiKey",
      "*.apiSecret",
      "headers.authorization",
      "headers.X-BAPI-API-KEY",
      "headers.X-BAPI-SIGN",
      "masterKey",
      "serviceRoleKey",
      "telegramBotToken"
    ],
    censor: "[REDACTED]"
  }
});
