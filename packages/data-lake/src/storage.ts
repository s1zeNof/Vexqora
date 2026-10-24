import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import type {
  HistoricalKlineRecord,
  PublicTradeRecord,
  FundingRateRecord,
  OpenInterestRecord,
  DataLakeMetadata,
  DataLakeCoverage
} from "./types";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export function getDataLakeRoot(): string {
  if (process.env.DATA_LAKE_PATH) {
    return path.resolve(process.env.DATA_LAKE_PATH);
  }
  // Default to data/ directory in project root
  return path.resolve(process.cwd(), "data");
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function writeGzipJson<T>(filePath: string, data: T): Promise<void> {
  ensureDir(path.dirname(filePath));
  const jsonStr = JSON.stringify(data);
  const compressed = await gzip(Buffer.from(jsonStr, "utf-8"));
  const tempPath = `${filePath}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, compressed);
  await fs.promises.rename(tempPath, filePath);
}

async function readGzipJson<T>(filePath: string): Promise<T | null> {
  if (!fs.existsSync(filePath)) return null;
  try {
    const compressed = await fs.promises.readFile(filePath);
    const uncompressed = await gunzip(compressed);
    return JSON.parse(uncompressed.toString("utf-8")) as T;
  } catch {
    return null;
  }
}

/**
 * Detects gaps in candlestick timestamps.
 */
export function detectKlineGaps(
  klines: HistoricalKlineRecord[],
  expectedIntervalMs: number
): Array<{ from: number; to: number }> {
  const gaps: Array<{ from: number; to: number }> = [];
  if (klines.length < 2) return gaps;

  for (let i = 1; i < klines.length; i++) {
    const prev = klines[i - 1]!;
    const curr = klines[i]!;
    const diff = curr.timestamp - prev.timestamp;

    // Allow small jitter (up to 1.5x expected interval)
    if (diff > expectedIntervalMs * 1.5) {
      gaps.push({ from: prev.timestamp, to: curr.timestamp });
    }
  }

  return gaps;
}

/**
 * Saves and merges historical klines with existing data lake storage.
 */
export async function saveHistoricalKlines(
  symbol: string,
  timeframe: string,
  newKlines: HistoricalKlineRecord[]
): Promise<DataLakeMetadata> {
  const root = getDataLakeRoot();
  const filePath = path.join(root, "klines", timeframe, `${symbol.toUpperCase()}.json.gz`);

  const existing = (await readGzipJson<HistoricalKlineRecord[]>(filePath)) ?? [];

  // Merge and deduplicate by timestamp
  const map = new Map<number, HistoricalKlineRecord>();
  for (const k of existing) {
    map.set(k.timestamp, k);
  }
  for (const k of newKlines) {
    map.set(k.timestamp, k);
  }

  const merged = Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);

  await writeGzipJson(filePath, merged);

  // Calculate timeframe interval in ms
  let intervalMs = 15 * 60 * 1000;
  if (timeframe === "1m") intervalMs = 60 * 1000;
  else if (timeframe === "5m") intervalMs = 5 * 60 * 1000;
  else if (timeframe === "15m") intervalMs = 15 * 60 * 1000;
  else if (timeframe === "1h") intervalMs = 60 * 60 * 1000;
  else if (timeframe === "4h") intervalMs = 4 * 60 * 60 * 1000;
  else if (timeframe === "1d") intervalMs = 24 * 60 * 60 * 1000;

  const gaps = detectKlineGaps(merged, intervalMs);

  const meta: DataLakeMetadata = {
    dataset: "klines",
    symbol: symbol.toUpperCase(),
    timeframe,
    count: merged.length,
    firstTimestamp: merged[0]?.timestamp ?? 0,
    lastTimestamp: merged[merged.length - 1]?.timestamp ?? 0,
    updatedAt: new Date().toISOString(),
    gapsDetected: gaps.length > 0 ? gaps : undefined
  };

  const metaPath = path.join(root, "klines", timeframe, `${symbol.toUpperCase()}.meta.json`);
  await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");

  return meta;
}

/**
 * Loads historical klines from data lake storage.
 */
export async function loadHistoricalKlines(
  symbol: string,
  timeframe: string,
  options?: {
    fromTime?: number | undefined;
    toTime?: number | undefined;
    limit?: number | undefined;
  }
): Promise<HistoricalKlineRecord[]> {
  const root = getDataLakeRoot();
  const filePath = path.join(root, "klines", timeframe, `${symbol.toUpperCase()}.json.gz`);

  const all = (await readGzipJson<HistoricalKlineRecord[]>(filePath)) ?? [];
  if (all.length === 0) return [];

  let filtered = all;

  if (options?.fromTime !== undefined) {
    filtered = filtered.filter((k) => k.timestamp >= options.fromTime!);
  }
  if (options?.toTime !== undefined) {
    filtered = filtered.filter((k) => k.timestamp <= options.toTime!);
  }
  if (options?.limit !== undefined && options.limit > 0) {
    filtered = filtered.slice(-options.limit);
  }

  return filtered;
}

/**
 * Saves a daily trade archive for a specific symbol and date.
 */
export async function saveDailyTrades(
  symbol: string,
  date: string, // YYYY-MM-DD
  trades: PublicTradeRecord[]
): Promise<void> {
  const root = getDataLakeRoot();
  const filePath = path.join(root, "trades", symbol.toUpperCase(), `${date}.json.gz`);
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  await writeGzipJson(filePath, sorted);
}

/**
 * Loads daily trade records.
 */
export async function loadDailyTrades(
  symbol: string,
  date: string
): Promise<PublicTradeRecord[]> {
  const root = getDataLakeRoot();
  const filePath = path.join(root, "trades", symbol.toUpperCase(), `${date}.json.gz`);
  return (await readGzipJson<PublicTradeRecord[]>(filePath)) ?? [];
}

/**
 * Saves and merges funding rates history.
 */
export async function saveFundingRates(
  symbol: string,
  records: FundingRateRecord[]
): Promise<void> {
  const root = getDataLakeRoot();
  const filePath = path.join(root, "derivatives", symbol.toUpperCase(), "funding.json.gz");
  const existing = (await readGzipJson<FundingRateRecord[]>(filePath)) ?? [];

  const map = new Map<number, FundingRateRecord>();
  for (const r of existing) map.set(r.timestamp, r);
  for (const r of records) map.set(r.timestamp, r);

  const merged = Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
  await writeGzipJson(filePath, merged);
}

/**
 * Loads funding rates history.
 */
export async function loadFundingRates(symbol: string): Promise<FundingRateRecord[]> {
  const root = getDataLakeRoot();
  const filePath = path.join(root, "derivatives", symbol.toUpperCase(), "funding.json.gz");
  return (await readGzipJson<FundingRateRecord[]>(filePath)) ?? [];
}

/**
 * Saves and merges open interest history.
 */
export async function saveOpenInterest(
  symbol: string,
  records: OpenInterestRecord[]
): Promise<void> {
  const root = getDataLakeRoot();
  const filePath = path.join(root, "derivatives", symbol.toUpperCase(), "open_interest.json.gz");
  const existing = (await readGzipJson<OpenInterestRecord[]>(filePath)) ?? [];

  const map = new Map<number, OpenInterestRecord>();
  for (const r of existing) map.set(r.timestamp, r);
  for (const r of records) map.set(r.timestamp, r);

  const merged = Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
  await writeGzipJson(filePath, merged);
}

/**
 * Loads open interest history.
 */
export async function loadOpenInterest(symbol: string): Promise<OpenInterestRecord[]> {
  const root = getDataLakeRoot();
  const filePath = path.join(root, "derivatives", symbol.toUpperCase(), "open_interest.json.gz");
  return (await readGzipJson<OpenInterestRecord[]>(filePath)) ?? [];
}

/**
 * Scans the local data lake and returns a coverage summary for all datasets.
 */
export async function getDataLakeCoverageSummary(): Promise<DataLakeCoverage[]> {
  const root = getDataLakeRoot();
  const results: DataLakeCoverage[] = [];

  if (!fs.existsSync(root)) return results;

  // 1. Klines
  const klinesDir = path.join(root, "klines");
  if (fs.existsSync(klinesDir)) {
    const timeframes = await fs.promises.readdir(klinesDir);
    for (const tf of timeframes) {
      const tfDir = path.join(klinesDir, tf);
      const stat = await fs.promises.stat(tfDir);
      if (stat.isDirectory()) {
        const files = await fs.promises.readdir(tfDir);
        for (const file of files) {
          if (file.endsWith(".json.gz")) {
            const symbol = file.replace(".json.gz", "");
            const fullPath = path.join(tfDir, file);
            const fileStat = await fs.promises.stat(fullPath);
            const data = (await readGzipJson<HistoricalKlineRecord[]>(fullPath)) ?? [];
            if (data.length > 0) {
              results.push({
                symbol,
                dataset: "klines",
                timeframe: tf,
                count: data.length,
                fromDate: new Date(data[0]!.timestamp).toISOString(),
                toDate: new Date(data[data.length - 1]!.timestamp).toISOString(),
                fileSizeBytes: fileStat.size
              });
            }
          }
        }
      }
    }
  }

  // 2. Trades
  const tradesDir = path.join(root, "trades");
  if (fs.existsSync(tradesDir)) {
    const symbols = await fs.promises.readdir(tradesDir);
    for (const sym of symbols) {
      const symDir = path.join(tradesDir, sym);
      const stat = await fs.promises.stat(symDir);
      if (stat.isDirectory()) {
        const files = (await fs.promises.readdir(symDir)).filter((f) => f.endsWith(".json.gz"));
        let totalCount = 0;
        let totalBytes = 0;
        let minDate = "";
        let maxDate = "";

        for (const file of files) {
          const dateStr = file.replace(".json.gz", "");
          if (!minDate || dateStr < minDate) minDate = dateStr;
          if (!maxDate || dateStr > maxDate) maxDate = dateStr;
          const fullPath = path.join(symDir, file);
          const fileStat = await fs.promises.stat(fullPath);
          totalBytes += fileStat.size;
          totalCount += 1; // days count
        }

        if (totalCount > 0) {
          results.push({
            symbol: sym,
            dataset: "trades (daily archives)",
            count: totalCount,
            fromDate: minDate,
            toDate: maxDate,
            fileSizeBytes: totalBytes
          });
        }
      }
    }
  }

  return results;
}
