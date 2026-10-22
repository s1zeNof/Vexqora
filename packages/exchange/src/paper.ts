import type { Balance, ExchangeClient, InstrumentInfo, Order, OrderAck, OrderRequest, Position, Ticker, TradingStopParams, Unsubscribe, UserEvent } from "@crypto-bot/shared";

export interface PaperClientOptions {
  balance: number;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

interface BybitPublicEnvelope<T> { retCode: number; retMsg: string; result: { list: T[] } }

export class PaperExchangeClient implements ExchangeClient {
  readonly capabilities = Object.freeze({ requestDemoFunds: true, nativeTrailingStop: true });
  private readonly fetcher: typeof globalThis.fetch;
  private readonly now: () => number;

  constructor(private balance: number, options: Omit<PaperClientOptions, "balance"> = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  private async market<T>(path: string, params: Record<string, string>): Promise<T> {
    const query = new URLSearchParams(params).toString();
    const urls = [
      `https://api.bybit.com${path}?${query}`,
      `https://api-demo.bybit.com${path}?${query}`
    ];
    let lastError: Error | null = null;
    for (const url of urls) {
      try {
        const response = await this.fetcher(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json"
          }
        });
        if (response.ok) {
          const envelope = await response.json() as BybitPublicEnvelope<T>;
          if (envelope.retCode === 0 && envelope.result?.list?.[0]) {
            return envelope.result.list[0];
          }
        } else {
          lastError = new Error(`Market data HTTP ${response.status}`);
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw lastError ?? new Error("Market data request failed");
  }

  getBalance(): Promise<Balance> { return Promise.resolve({ equity: this.balance, available: this.balance, currency: "USDT" }); }

  async getInstrument(symbol: string): Promise<InstrumentInfo> {
    const norm = symbol.toUpperCase();
    try {
      const item = await this.market<{ symbol: string; leverageFilter: { maxLeverage: string }; priceFilter: { tickSize: string }; lotSizeFilter: { qtyStep: string; minOrderQty: string; minNotionalValue: string } }>("/v5/market/instruments-info", { category: "linear", symbol: norm });
      return {
        symbol: item.symbol,
        tickSize: Number(item.priceFilter.tickSize),
        qtyStep: Number(item.lotSizeFilter.qtyStep),
        minQty: Number(item.lotSizeFilter.minOrderQty),
        minNotional: Number(item.lotSizeFilter.minNotionalValue),
        maxLeverage: Number(item.leverageFilter.maxLeverage)
      };
    } catch {
      // Fallback to Binance Futures exchangeInfo if Bybit public API is blocked
      try {
        const res = await this.fetcher(`https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=${norm}`, {
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        if (res.ok) {
          const data = await res.json() as {
            symbols?: Array<{
              symbol: string;
              filters: Array<{ filterType: string; tickSize?: string; stepSize?: string; minQty?: string; notional?: string }>;
            }>;
          };
          const symInfo = data.symbols?.[0];
          if (symInfo) {
            const priceFilter = symInfo.filters.find(f => f.filterType === "PRICE_FILTER");
            const lotFilter = symInfo.filters.find(f => f.filterType === "LOT_SIZE");
            const notionalFilter = symInfo.filters.find(f => f.filterType === "MIN_NOTIONAL");
            return {
              symbol: norm,
              tickSize: Number(priceFilter?.tickSize ?? 0.1),
              qtyStep: Number(lotFilter?.stepSize ?? 0.001),
              minQty: Number(lotFilter?.minQty ?? 0.001),
              minNotional: Number(notionalFilter?.notional ?? 5),
              maxLeverage: 50
            };
          }
        }
      } catch {
        // Continue to fallback defaults
      }

      const isBtc = norm.includes("BTC");
      const isEth = norm.includes("ETH");
      return {
        symbol: norm,
        tickSize: isBtc ? 0.1 : (isEth ? 0.01 : 0.001),
        qtyStep: isBtc ? 0.001 : (isEth ? 0.01 : 0.1),
        minQty: isBtc ? 0.001 : (isEth ? 0.01 : 0.1),
        minNotional: 5,
        maxLeverage: isBtc || isEth ? 100 : 50
      };
    }
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const norm = symbol.toUpperCase();
    try {
      const item = await this.market<{ symbol: string; lastPrice: string }>("/v5/market/tickers", { category: "linear", symbol: norm });
      return { symbol: item.symbol, lastPrice: Number(item.lastPrice) };
    } catch {
      // Fallback to Binance Futures or Spot price if Bybit is blocked (e.g. HTTP 403 on US IP)
      try {
        const res = await this.fetcher(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${norm}`, {
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        if (res.ok) {
          const data = await res.json() as { symbol: string; price: string };
          if (data?.price) {
            return { symbol: norm, lastPrice: Number(data.price) };
          }
        }
      } catch {
        // Fallback to Binance Spot
        try {
          const res = await this.fetcher(`https://api.binance.com/api/v3/ticker/price?symbol=${norm}`, {
            headers: { "User-Agent": "Mozilla/5.0" }
          });
          if (res.ok) {
            const data = await res.json() as { symbol: string; price: string };
            if (data?.price) {
              return { symbol: norm, lastPrice: Number(data.price) };
            }
          }
        } catch {
          // ignore
        }
      }
      throw new Error(`Market data HTTP 403: Bybit geoblocked this region and fallbacks were unreachable for ${norm}`);
    }
  }
  setLeverage(symbol: string, leverage: number): Promise<void> { void symbol; void leverage; return Promise.resolve(); }
  placeOrder(order: OrderRequest): Promise<OrderAck> { return Promise.resolve({ orderId: `paper-${this.now()}`, orderLinkId: order.orderLinkId }); }
  cancelOrder(symbol: string, orderId: string): Promise<void> { void symbol; void orderId; return Promise.resolve(); }
  setTradingStop(params: TradingStopParams): Promise<void> { void params; return Promise.resolve(); }
  getPositions(symbol?: string): Promise<Position[]> { void symbol; return Promise.resolve([]); }
  getOpenOrders(symbol?: string): Promise<Order[]> { void symbol; return Promise.resolve([]); }
  closePosition(symbol: string, qty?: number): Promise<OrderAck> { void qty; return Promise.resolve({ orderId: `paper-close-${this.now()}`, orderLinkId: `paper-close-${symbol}-${this.now()}`.slice(0, 36) }); }
  subscribeUserStream(handler: (event: UserEvent) => void): Unsubscribe { void handler; return () => undefined; }
  requestDemoFunds(amount: number): Promise<void> { this.balance += amount; return Promise.resolve(); }
}

export function createPaperExchangeClient(options: PaperClientOptions): ExchangeClient {
  return new PaperExchangeClient(options.balance, options);
}

