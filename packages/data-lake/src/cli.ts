import { downloadHistoricalKlines } from "./bybit-klines-downloader";
import { downloadBybitDailyTrades } from "./bybit-public-trades-downloader";
import { downloadHistoricalFunding, downloadHistoricalOpenInterest } from "./derivatives-downloader";
import { queryCoverage } from "./query-engine";

function parseArgs(args: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const [key, val] = arg.slice(2).split("=");
      if (key && val) {
        params[key] = val;
      }
    }
  }
  return params;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? "status";
  const params = parseArgs(args.slice(1));

  console.log(`\n🌊 Vexqora Market Data Lake CLI`);
  console.log(`──────────────────────────────────────────`);

  if (command === "download") {
    const symbol = params.symbol ?? "BTCUSDT";
    const timeframe = params.timeframe ?? "15m";
    const days = params.days ? Number(params.days) : 30;

    console.log(`📥 Downloading ${timeframe} klines for ${symbol} (${days} days)...`);
    const res = await downloadHistoricalKlines({
      symbol,
      timeframe,
      days,
      onProgress: (info) => {
        console.log(`  Progress: ${info.fetchedCandles} candles | Range: ${info.currentRange}`);
      }
    });
    console.log(`✅ Success: Stored ${res.totalDownloaded} candles for ${res.symbol} (${res.timeframe}).\n`);
  } else if (command === "trades") {
    const symbol = params.symbol ?? "BTCUSDT";
    const date = params.date ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0]!;

    console.log(`📥 Downloading Bybit public trades archive for ${symbol} on ${date}...`);
    const res = await downloadBybitDailyTrades({ symbol, date });
    console.log(`✅ Success: Stored ${res.tradesCount} trades for ${res.symbol} on ${res.date}.\n`);
  } else if (command === "derivatives") {
    const symbol = params.symbol ?? "BTCUSDT";
    console.log(`📥 Downloading Funding Rates & Open Interest for ${symbol}...`);
    const [funding, oi] = await Promise.all([
      downloadHistoricalFunding(symbol),
      downloadHistoricalOpenInterest(symbol)
    ]);
    console.log(`✅ Success: Stored ${funding.recordsCount} funding rates and ${oi.recordsCount} open interest points.\n`);
  } else if (command === "status") {
    console.log(`📊 Scanning local data lake coverage...\n`);
    const coverage = await queryCoverage();
    if (coverage.length === 0) {
      console.log(`Data lake is empty. Run: npm run data:download -- --symbol=BTCUSDT --days=30`);
    } else {
      console.table(
        coverage.map((c) => ({
          Symbol: c.symbol,
          Dataset: c.dataset,
          Timeframe: c.timeframe ?? "N/A",
          Records: c.count,
          "From Date": c.fromDate.split("T")[0],
          "To Date": c.toDate.split("T")[0],
          "Size (KB)": Math.round(c.fileSizeBytes / 1024)
        }))
      );
    }
  } else {
    console.log(`Unknown command: ${command}`);
    console.log(`Available commands: download, trades, derivatives, status`);
  }
}

void main().catch((err) => {
  console.error("Data Lake CLI Error:", err);
  process.exit(1);
});
