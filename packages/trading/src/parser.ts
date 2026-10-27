import { signalSchema, type Signal } from "@crypto-bot/shared";

export class SignalParseError extends Error {
  constructor(message: string, readonly line?: string) {
    super(message);
    this.name = "SignalParseError";
  }
}

function parsePositive(value: string, field: string): number {
  const result = Number(value.replace(",", "."));
  if (!Number.isFinite(result) || result <= 0) throw new SignalParseError(`${field} must be a positive number`);
  return result;
}

function requiredLine(lines: string[], prefix: string): string {
  const line = lines.find((candidate) => candidate.toLowerCase().startsWith(prefix));
  if (!line) throw new SignalParseError(`Missing ${prefix.trim()} line`);
  return line.slice(prefix.length).trim();
}

export function parseSignalText(rawText: string, source: Signal["source"] = "chat"): Signal {
  // Strip inline bracketed tags (e.g. [origin:pulse:...]) and comments (# ...)
  const sanitizedText = rawText
    .replace(/\[.*?\]/g, "")
    .replace(/#.*$/gm, "");

  const lines = sanitizedText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines[0]?.match(/^([A-Z0-9]{5,20})\s+(LONG|SHORT)$/i);
  if (!header?.[1] || !header[2]) throw new SignalParseError("First line must be SYMBOL LONG or SYMBOL SHORT", lines[0]);

  const entryRaw = requiredLine(lines.slice(1), "entry ");
  let entry: Signal["entry"];
  if (/^market$/i.test(entryRaw)) {
    entry = { type: "market" };
  } else {
    const range = entryRaw.match(/^(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)$/);
    entry = range?.[1] && range[2]
      ? { type: "range", from: parsePositive(range[1], "Entry from"), to: parsePositive(range[2], "Entry to") }
      : { type: "limit", price: parsePositive(entryRaw, "Entry") };
  }

  const takeProfits = requiredLine(lines.slice(1), "tp ").split(",").map((part, index) => {
    const match = part.trim().match(/^(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)%$/);
    if (!match?.[1] || !match[2]) throw new SignalParseError(`Invalid TP${index + 1}; expected PRICE SHARE%`, part);
    return { price: parsePositive(match[1], `TP${index + 1}`), sharePct: parsePositive(match[2], `TP${index + 1} share`) };
  });

  const trailingLine = lines.find((line) => line.toLowerCase().startsWith("trail "));
  const leverageLine = lines.find((line) => line.toLowerCase().startsWith("lev "));
  const riskLine = lines.find((line) => line.toLowerCase().startsWith("risk "));
  let trailingStop: Signal["trailingStop"];
  if (trailingLine) {
    const match = trailingLine.slice(6).trim().match(/^(\d+(?:[.,]\d+)?)(%)?(?:\s+after\s+tp(\d+))?$/i);
    if (!match?.[1]) throw new SignalParseError("Invalid trail; expected DISTANCE or PERCENT%", trailingLine);
    const tpTargetNum = match[3] ? parseInt(match[3], 10) : 1;
    const activationPrice = takeProfits[tpTargetNum - 1]?.price;
    trailingStop = {
      distance: { type: match[2] ? "percent" : "absolute", value: parsePositive(match[1], "Trailing distance") },
      ...(activationPrice !== undefined ? { activationPrice } : {})
    };
  }

  let leverage: number | undefined;
  if (leverageLine) {
    const match = leverageLine.slice(4).trim().match(/^(\d+(?:[.,]\d+)?)/);
    leverage = parsePositive(match?.[1] ?? leverageLine.slice(4).trim(), "Leverage");
  }

  let riskPct: number | undefined;
  if (riskLine) {
    const match = riskLine.slice(5).trim().match(/^(\d+(?:[.,]\d+)?)/);
    riskPct = parsePositive(match?.[1] ?? riskLine.slice(5).trim().replace(/%$/, ""), "Risk");
  }

  const candidate = {
    symbol: header[1],
    side: header[2].toLowerCase(),
    entry,
    stopLoss: parsePositive(requiredLine(lines.slice(1), "sl "), "Stop loss"),
    takeProfits,
    ...(trailingStop ? { trailingStop } : {}),
    ...(leverage !== undefined ? { leverage } : {}),
    ...(riskPct !== undefined ? { riskPct } : {}),
    source
  };
  const result = signalSchema.safeParse(candidate);
  if (!result.success) throw new SignalParseError(result.error.issues[0]?.message ?? "Invalid signal");
  return result.data;
}
