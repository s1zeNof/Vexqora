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
    const response = await this.fetcher(`https://api.bybit.com${path}?${query}`);
    if (!response.ok) throw new Error(`Market data HTTP ${response.status}`);
    const envelope = await response.json() as BybitPublicEnvelope<T>;
    if (envelope.retCode !== 0) throw new Error(`Market data ${envelope.retCode}: ${envelope.retMsg}`);
    const item = envelope.result.list[0];
    if (!item) throw new Error("Market data returned no result");
    return item;
  }

  getBalance(): Promise<Balance> { return Promise.resolve({ equity: this.balance, available: this.balance, currency: "USDT" }); }
  async getInstrument(symbol: string): Promise<InstrumentInfo> {
    const item = await this.market<{ symbol: string; leverageFilter: { maxLeverage: string }; priceFilter: { tickSize: string }; lotSizeFilter: { qtyStep: string; minOrderQty: string; minNotionalValue: string } }>("/v5/market/instruments-info", { category: "linear", symbol: symbol.toUpperCase() });
    return { symbol: item.symbol, tickSize: Number(item.priceFilter.tickSize), qtyStep: Number(item.lotSizeFilter.qtyStep), minQty: Number(item.lotSizeFilter.minOrderQty), minNotional: Number(item.lotSizeFilter.minNotionalValue), maxLeverage: Number(item.leverageFilter.maxLeverage) };
  }
  async getTicker(symbol: string): Promise<Ticker> {
    const item = await this.market<{ symbol: string; lastPrice: string }>("/v5/market/tickers", { category: "linear", symbol: symbol.toUpperCase() });
    return { symbol: item.symbol, lastPrice: Number(item.lastPrice) };
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

