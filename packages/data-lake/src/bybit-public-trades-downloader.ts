import zlib from "node:zlib";
import { promisify } from "node:util";
import type { PublicTradeRecord } from "./types";
import { saveDailyTrades } from "./storage";

const gunzip = promisify(zlib.gunzip);

export interface DownloadTradesOptions {
  symbol: string;
  date: string; // YYYY-MM-DD
}

/**
 * Downloads and parses Bybit public daily trade archives from https://public.bybit.com/trading/
 */
export async function downloadBybitDailyTrades(
  options: DownloadTradesOptions
): Promise<{ symbol: string; date: string; tradesCount: number }> {
  const symbol = options.symbol.toUpperCase();
  const date = options.date;

  const url = `https://public.bybit.com/trading/${symbol}/${symbol}${date}.csv.gz`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Vexqora-DataLake/1.0" }
  });

  if (!res.ok) {
    throw new Error(`Failed to download public trades for ${symbol} on ${date}: HTTP ${res.status}`);
  }

  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  const decompressed = await gunzip(buffer);
  const csvText = decompressed.toString("utf-8");

  const lines = csvText.split("\n");
  const trades: PublicTradeRecord[] = [];

  // Header: timestamp,symbol,side,size,price,tickDirection,trdMatchID,grossValue,homeNotional,foreignNotional
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    const parts = line.split(",");
    if (parts.length >= 5) {
      const rawTs = Number(parts[0]);
      // Some archives use seconds with decimals, some ms
      const timestamp = rawTs < 1e11 ? Math.round(rawTs * 1000) : Math.round(rawTs);
      const side = parts[2]?.toLowerCase() === "buy" ? "Buy" : "Sell";
      const size = Number(parts[3]);
      const price = Number(parts[4]);
      const tickDirection = parts[5];

      if (timestamp && !Number.isNaN(price) && !Number.isNaN(size)) {
        trades.push({
          timestamp,
          price,
          size,
          side,
          tickDirection
        });
      }
    }
  }

  await saveDailyTrades(symbol, date, trades);

  return {
    symbol,
    date,
    tradesCount: trades.length
  };
}
