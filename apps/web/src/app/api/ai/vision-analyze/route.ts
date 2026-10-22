import { NextResponse } from "next/server";
import { callNemotronVision } from "@crypto-bot/trading";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { image?: string; symbol?: string };
    if (!body.image) {
      return NextResponse.json({ error: "Image data is required" }, { status: 400 });
    }

    const symbol = (body.symbol || "BTCUSDT").toUpperCase();
    const analysis = await callNemotronVision(body.image, undefined, {
      symbol
    });

    return NextResponse.json({ analysis });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Vision analysis failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
