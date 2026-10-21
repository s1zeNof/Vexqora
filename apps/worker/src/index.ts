import "dotenv/config";
import pino from "pino";

const logger = pino({
  redact: {
    paths: ["apiKey", "apiSecret", "*.apiKey", "*.apiSecret", "headers.authorization"],
    censor: "[REDACTED]"
  }
});

logger.info({ service: "worker" }, "Trading worker started");

