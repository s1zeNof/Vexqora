export function formatCryptoPrice(price?: number | null): string {
  if (price == null || !Number.isFinite(price) || price === 0) return "—";

  const abs = Math.abs(price);
  if (abs >= 1000) {
    return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (abs >= 1) {
    return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  if (abs >= 0.01) {
    return price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  }
  if (abs >= 0.0001) {
    return price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 7 });
  }
  return price.toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 8 });
}

export function sanitizeSymbol(raw: string): string {
  if (!raw || typeof raw !== "string") return "BTCUSDT";

  // 1. Strip pulse prefix (e.g. pulse-, pulse:, pulse_)
  let clean = raw.trim().replace(/^pulse[-:_]?/i, "");

  // 2. Strip trailing timestamps (e.g. -2987959 or 2987959 or 2987959USDT)
  clean = clean.replace(/[-:_]?\d+(USDT)?$/i, "");

  // 3. Find standard crypto pair ending in USDT (e.g. IRYSUSDT, BIRBUSDT, BTCUSDT)
  const usdtMatch = /([A-Z0-9]{2,10}USDT)/i.exec(clean);
  if (usdtMatch && usdtMatch[1]) {
    return usdtMatch[1].toUpperCase();
  }

  // 4. Strip non-alphanumeric chars
  clean = clean.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!clean) return "BTCUSDT";
  return clean.endsWith("USDT") ? clean : `${clean}USDT`;
}
