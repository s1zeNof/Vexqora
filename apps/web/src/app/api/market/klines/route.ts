import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fetchRecentKlines } from "@crypto-bot/exchange";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.toUpperCase() ?? "BTCUSDT";
  const interval = searchParams.get("interval") ?? "15";
  const limit = Math.min(100, Math.max(10, Number(searchParams.get("limit") ?? 50)));

  try {
    const klines = await fetchRecentKlines(symbol, interval, limit);
    return NextResponse.json({ success: true, symbol, interval, klines });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch klines";
    return NextResponse.json({ success: false, error: message, klines: [] }, { status: 500 });
  }
}
