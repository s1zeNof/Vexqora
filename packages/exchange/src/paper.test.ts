import { describe, expect, it, vi } from "vitest";
import { PaperExchangeClient } from "./paper";

describe("PaperExchangeClient", () => {
  it("provides an internal balance without credentials", async () => {
    const client = new PaperExchangeClient(10_000);
    await expect(client.getBalance()).resolves.toEqual({ equity: 10_000, available: 10_000, currency: "USDT" });
  });

  it("uses public Bybit prices without authentication headers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ retCode: 0, retMsg: "OK", result: { list: [{ symbol: "BTCUSDT", lastPrice: "65000" }] } }), { status: 200 }));
    const client = new PaperExchangeClient(10_000, { fetch: fetcher });
    await expect(client.getTicker("BTCUSDT")).resolves.toEqual({ symbol: "BTCUSDT", lastPrice: 65_000 });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/v5/market/tickers?"), expect.anything());
  });

  it("falls back to Binance public price if Bybit returns 403", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("Access Denied", { status: 403 }))
      .mockResolvedValueOnce(new Response("Access Denied", { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ symbol: "BTCUSDT", price: "66000" }), { status: 200 }));
    const client = new PaperExchangeClient(10_000, { fetch: fetcher });
    await expect(client.getTicker("BTCUSDT")).resolves.toEqual({ symbol: "BTCUSDT", lastPrice: 66_000 });
  });
});
