import type { FundingRateRecord, OpenInterestRecord } from "./types";
import { saveFundingRates, saveOpenInterest } from "./storage";

/**
 * Downloads historical Funding Rate records from Bybit V5 Linear API.
 */
export async function downloadHistoricalFunding(
  symbol: string,
  limit: number = 200
): Promise<{ symbol: string; recordsCount: number }> {
  const normSymbol = symbol.toUpperCase();
  const url = `https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${normSymbol}&limit=${Math.min(limit, 200)}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Vexqora-DataLake/1.0", "Accept": "application/json" }
  });

  if (!res.ok) {
    throw new Error(`Bybit Funding API error: HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    retCode: number;
    result?: {
      list?: Array<{
        symbol: string;
        fundingRate: string;
        fundingRateTimestamp: string;
      }>;
    };
  };

  const records: FundingRateRecord[] = [];
  for (const item of json.result?.list ?? []) {
    const ts = Number(item.fundingRateTimestamp);
    const fr = Number(item.fundingRate);
    if (ts && !Number.isNaN(fr)) {
      records.push({
        timestamp: ts,
        fundingRate: fr,
        symbol: normSymbol
      });
    }
  }

  await saveFundingRates(normSymbol, records);

  return {
    symbol: normSymbol,
    recordsCount: records.length
  };
}

/**
 * Downloads historical Open Interest records from Bybit V5 Linear API.
 */
export async function downloadHistoricalOpenInterest(
  symbol: string,
  intervalTime: "5min" | "15min" | "30min" | "1h" | "4h" | "1d" = "15min"
): Promise<{ symbol: string; recordsCount: number }> {
  const normSymbol = symbol.toUpperCase();
  const url = `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${normSymbol}&intervalTime=${intervalTime}&limit=200`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Vexqora-DataLake/1.0", "Accept": "application/json" }
  });

  if (!res.ok) {
    throw new Error(`Bybit Open Interest API error: HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    retCode: number;
    result?: {
      list?: Array<{
        openInterest: string;
        timestamp: string;
      }>;
    };
  };

  const records: OpenInterestRecord[] = [];
  for (const item of json.result?.list ?? []) {
    const ts = Number(item.timestamp);
    const oi = Number(item.openInterest);
    if (ts && !Number.isNaN(oi)) {
      records.push({
        timestamp: ts,
        openInterest: oi,
        symbol: normSymbol
      });
    }
  }

  await saveOpenInterest(normSymbol, records);

  return {
    symbol: normSymbol,
    recordsCount: records.length
  };
}
