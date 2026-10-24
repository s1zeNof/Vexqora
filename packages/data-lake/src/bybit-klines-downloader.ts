import type { HistoricalKlineRecord } from "./types";
import { saveHistoricalKlines } from "./storage";

export interface DownloadKlinesOptions {
  symbol: string;
  timeframe?: string | undefined;
  days?: number | undefined;
  fromTime?: number | undefined;
  toTime?: number | undefined;
  onProgress?: ((info: { fetchedCandles: number; currentRange: string }) => void) | undefined;
}

function parseBybitInterval(tf: string): string {
  if (tf === "1m") return "1";
  if (tf === "5m") return "5";
  if (tf === "15m") return "15";
  if (tf === "1h") return "60";
  if (tf === "4h") return "240";
  if (tf === "1d") return "D";
  return tf;
}

/**
 * Downloads multi-day historical candlesticks from Bybit V5 Linear API.
 */
export async function downloadHistoricalKlines(
  options: DownloadKlinesOptions
): Promise<{ totalDownloaded: number; symbol: string; timeframe: string }> {
  const symbol = options.symbol.toUpperCase();
  const timeframe = options.timeframe ?? "15m";
  const interval = parseBybitInterval(timeframe);

  const now = options.toTime ?? Date.now();
  const days = options.days ?? 30;
  const targetStartTime = options.fromTime ?? (now - days * 24 * 60 * 60 * 1000);

  let currentEnd = now;
  const allCandles: HistoricalKlineRecord[] = [];
  const pageSize = 1000;

  while (currentEnd > targetStartTime) {
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${pageSize}&end=${currentEnd}`;

    const res = await fetch(url, {
      headers: { "User-Agent": "Vexqora-DataLake/1.0", "Accept": "application/json" }
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Bybit API error (${res.status}): ${errText}`);
    }

    const json = (await res.json()) as {
      retCode: number;
      retMsg: string;
      result?: {
        list?: string[][];
      };
    };

    if (json.retCode !== 0 || !json.result?.list || json.result.list.length === 0) {
      break;
    }

    const rows = json.result.list;
    const pageCandles: HistoricalKlineRecord[] = [];

    for (const r of rows) {
      const startTime = Number(r[0]);
      const open = Number(r[1]);
      const high = Number(r[2]);
      const low = Number(r[3]);
      const close = Number(r[4]);
      const volume = Number(r[5]);
      const turnover = Number(r[6] ?? 0);

      if (startTime && !Number.isNaN(open) && !Number.isNaN(close)) {
        pageCandles.push({
          timestamp: startTime,
          open,
          high,
          low,
          close,
          volume,
          turnover
        });
      }
    }

    if (pageCandles.length === 0) break;

    // Bybit returns newest first, sort oldest first
    pageCandles.sort((a, b) => a.timestamp - b.timestamp);
    allCandles.push(...pageCandles);

    const oldestInPage = pageCandles[0]!.timestamp;

    if (options.onProgress) {
      options.onProgress({
        fetchedCandles: allCandles.length,
        currentRange: `${new Date(oldestInPage).toISOString()} -> ${new Date(currentEnd).toISOString()}`
      });
    }

    // Next page must end strictly before the oldest candle in this page
    if (oldestInPage <= targetStartTime || oldestInPage >= currentEnd) {
      break;
    }

    currentEnd = oldestInPage - 1;

    // Small delay to respect Bybit rate limits (up to 10 req/s)
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  // Deduplicate and save into data lake
  await saveHistoricalKlines(symbol, timeframe, allCandles);

  return {
    totalDownloaded: allCandles.length,
    symbol,
    timeframe
  };
}
