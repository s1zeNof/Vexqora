import type {
  HistoricalKlineRecord,
  PublicTradeRecord,
  FundingRateRecord,
  OpenInterestRecord,
  DataLakeCoverage
} from "./types";
import {
  loadHistoricalKlines,
  loadDailyTrades,
  loadFundingRates,
  loadOpenInterest,
  getDataLakeCoverageSummary
} from "./storage";

export interface QueryKlinesOptions {
  symbol: string;
  timeframe?: string | undefined;
  fromTime?: number | undefined;
  toTime?: number | undefined;
  limit?: number | undefined;
}

/**
 * Fast query interface for historical candlesticks stored in the data lake.
 */
export async function queryKlines(options: QueryKlinesOptions): Promise<HistoricalKlineRecord[]> {
  const timeframe = options.timeframe ?? "15m";
  return loadHistoricalKlines(options.symbol, timeframe, {
    fromTime: options.fromTime,
    toTime: options.toTime,
    limit: options.limit
  });
}

/**
 * Fast query interface for daily trade archives stored in the data lake.
 */
export async function queryDailyTrades(
  symbol: string,
  date: string
): Promise<PublicTradeRecord[]> {
  return loadDailyTrades(symbol, date);
}

/**
 * Fast query interface for funding rates history.
 */
export async function queryFundingRates(symbol: string): Promise<FundingRateRecord[]> {
  return loadFundingRates(symbol);
}

/**
 * Fast query interface for open interest history.
 */
export async function queryOpenInterest(symbol: string): Promise<OpenInterestRecord[]> {
  return loadOpenInterest(symbol);
}

/**
 * Returns coverage report of all stored assets and timeframes in the data lake.
 */
export async function queryCoverage(): Promise<DataLakeCoverage[]> {
  return getDataLakeCoverageSummary();
}
