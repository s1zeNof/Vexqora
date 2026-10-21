import { describe, expect, it, vi } from "vitest";
import { BybitClient, signBybitHmac } from "./bybit.js";

describe("BybitClient", () => {
  it("creates the documented HMAC SHA-256 signature", () => {
    expect(signBybitHmac("secret", "payload")).toBe("b82fcb791acec57859b989b430a826488ce2e479fdf92326bd0a2e8375a42ba4");
  });

  it("uses the demo host and maps unified balance", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      retCode: 0,
      retMsg: "OK",
      result: { list: [{ totalEquity: "1000.25", totalAvailableBalance: "900.5" }] },
      time: 1
    }), { status: 200 }));
    const client = new BybitClient({ apiKey: "key", apiSecret: "secret", environment: "demo", fetch: fetcher, now: () => 1 });
    await expect(client.getBalance()).resolves.toEqual({ equity: 1000.25, available: 900.5, currency: "USD" });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("https://api-demo.bybit.com/v5/account/wallet-balance"), expect.anything());
    expect(client.capabilities.requestDemoFunds).toBe(true);
  });

  it("does not expose demo funding for live accounts", () => {
    const client = new BybitClient({ apiKey: "key", apiSecret: "secret", environment: "live" });
    expect(client.capabilities.requestDemoFunds).toBe(false);
  });
});
