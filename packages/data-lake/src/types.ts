export interface HistoricalKlineRecord {
  timestamp: number; // millisecond timestamp (UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

export interface PublicTradeRecord {
  timestamp: number; // millisecond timestamp
  price: number;
  size: number;
  side: "Buy" | "Sell";
  tickDirection?: string | undefined;
}

export interface FundingRateRecord {
  timestamp: number;
  fundingRate: number;
  symbol: string;
}

export interface OpenInterestRecord {
  timestamp: number;
  openInterest: number;
  symbol: string;
}

export interface DataLakeMetadata {
  dataset: "klines" | "trades" | "derivatives";
  symbol: string;
  timeframe?: string | undefined;
  count: number;
  firstTimestamp: number;
  lastTimestamp: number;
  updatedAt: string;
  gapsDetected?: Array<{ from: number; to: number }> | undefined;
}

export interface DataLakeCoverage {
  symbol: string;
  dataset: string;
  timeframe?: string | undefined;
  count: number;
  fromDate: string;
  toDate: string;
  fileSizeBytes: number;
}
