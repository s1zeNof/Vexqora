import { createHmac } from "node:crypto";
import type {
  Balance,
  ExchangeClient,
  InstrumentInfo,
  Order,
  OrderAck,
  OrderRequest,
  Position,
  Ticker,
  TradingStopParams,
  Unsubscribe,
  UserEvent
} from "@crypto-bot/shared";

export type BybitEnvironment = "live" | "demo";

interface BybitClientOptions {
  apiKey: string;
  apiSecret: string;
  environment: BybitEnvironment;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  recvWindow?: number;
}

interface BybitEnvelope<T> {
  retCode: number;
  retMsg: string;
  result: T;
  time: number;
}

interface BybitList<T> { list: T[]; nextPageCursor?: string }

const HOSTS = {
  live: { rest: "https://api.bybit.com", privateWs: "wss://stream.bybit.com/v5/private" },
  demo: { rest: "https://api-demo.bybit.com", privateWs: "wss://stream-demo.bybit.com/v5/private" }
} as const;

function queryString(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function queryValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return `${value}`;
  return undefined;
}

export function signBybitHmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function number(value: string | undefined, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric value for ${field}`);
  return parsed;
}

export class BybitClient implements ExchangeClient {
  readonly capabilities;
  private readonly baseUrl;
  private readonly privateWsUrl;
  private readonly fetcher;
  private readonly now;
  private readonly recvWindow;

  constructor(private readonly options: BybitClientOptions) {
    const hosts = HOSTS[options.environment];
    this.baseUrl = hosts.rest;
    this.privateWsUrl = hosts.privateWs;
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.recvWindow = options.recvWindow ?? 5_000;
    this.capabilities = Object.freeze({ requestDemoFunds: options.environment === "demo", nativeTrailingStop: true });
  }

  private async request<T>(method: "GET" | "POST", path: string, params: Record<string, unknown> = {}): Promise<T> {
    const timestamp = String(this.now());
    const recvWindow = String(this.recvWindow);
    const stringParams = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, queryValue(value)]));
    const body = method === "POST" ? JSON.stringify(params) : "";
    const query = method === "GET" ? queryString(stringParams) : "";
    const signature = signBybitHmac(
      this.options.apiSecret,
      `${timestamp}${this.options.apiKey}${recvWindow}${method === "GET" ? query : body}`
    );
    const response = await this.fetcher(`${this.baseUrl}${path}${query ? `?${query}` : ""}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-BAPI-API-KEY": this.options.apiKey,
        "X-BAPI-SIGN": signature,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow
      },
      ...(method === "POST" ? { body } : {})
    });
    if (!response.ok) throw new Error(`Bybit HTTP ${response.status}`);
    const envelope = await response.json() as BybitEnvelope<T>;
    if (envelope.retCode !== 0) throw new Error(`Bybit ${envelope.retCode}: ${envelope.retMsg}`);
    return envelope.result;
  }

  async getBalance(): Promise<Balance> {
    const result = await this.request<BybitList<{
      totalEquity: string;
      totalAvailableBalance: string;
    }>>("GET", "/v5/account/wallet-balance", { accountType: "UNIFIED" });
    const account = result.list[0];
    if (!account) throw new Error("Bybit returned no unified account balance");
    return {
      equity: number(account.totalEquity, "totalEquity"),
      available: number(account.totalAvailableBalance, "totalAvailableBalance"),
      currency: "USD"
    };
  }

  async getInstrument(symbol: string): Promise<InstrumentInfo> {
    const result = await this.request<BybitList<{
      symbol: string;
      leverageFilter: { maxLeverage: string };
      priceFilter: { tickSize: string };
      lotSizeFilter: { qtyStep: string; minOrderQty: string; minNotionalValue: string };
    }>>("GET", "/v5/market/instruments-info", { category: "linear", symbol: symbol.toUpperCase() });
    const instrument = result.list[0];
    if (!instrument) throw new Error(`Unknown Bybit instrument: ${symbol}`);
    return {
      symbol: instrument.symbol,
      tickSize: number(instrument.priceFilter.tickSize, "tickSize"),
      qtyStep: number(instrument.lotSizeFilter.qtyStep, "qtyStep"),
      minQty: number(instrument.lotSizeFilter.minOrderQty, "minOrderQty"),
      minNotional: number(instrument.lotSizeFilter.minNotionalValue, "minNotionalValue"),
      maxLeverage: number(instrument.leverageFilter.maxLeverage, "maxLeverage")
    };
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const result = await this.request<BybitList<{ symbol: string; lastPrice: string }>>("GET", "/v5/market/tickers", {
      category: "linear", symbol: symbol.toUpperCase()
    });
    const ticker = result.list[0];
    if (!ticker) throw new Error(`No ticker found for ${symbol}`);
    return { symbol: ticker.symbol, lastPrice: number(ticker.lastPrice, "lastPrice") };
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    const value = String(leverage);
    await this.request("POST", "/v5/position/set-leverage", {
      category: "linear", symbol: symbol.toUpperCase(), buyLeverage: value, sellLeverage: value
    });
  }

  async placeOrder(order: OrderRequest): Promise<OrderAck> {
    const result = await this.request<{ orderId: string; orderLinkId: string }>("POST", "/v5/order/create", {
      category: "linear",
      symbol: order.symbol.toUpperCase(),
      side: order.side === "buy" ? "Buy" : "Sell",
      orderType: order.type === "market" ? "Market" : "Limit",
      qty: String(order.qty),
      ...(order.price === undefined ? {} : { price: String(order.price) }),
      ...(order.reduceOnly === undefined ? {} : { reduceOnly: order.reduceOnly }),
      orderLinkId: order.orderLinkId
    });
    return result;
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.request("POST", "/v5/order/cancel", { category: "linear", symbol: symbol.toUpperCase(), orderId });
  }

  async setTradingStop(params: TradingStopParams): Promise<void> {
    await this.request("POST", "/v5/position/trading-stop", {
      category: "linear",
      symbol: params.symbol.toUpperCase(),
      tpslMode: "Full",
      positionIdx: 0,
      ...(params.stopLoss === undefined ? {} : { stopLoss: String(params.stopLoss) }),
      ...(params.takeProfit === undefined ? {} : { takeProfit: String(params.takeProfit) }),
      ...(params.trailingStop === undefined ? {} : { trailingStop: String(params.trailingStop) }),
      ...(params.activePrice === undefined ? {} : { activePrice: String(params.activePrice) })
    });
  }

  async getPositions(symbol?: string): Promise<Position[]> {
    const result = await this.request<BybitList<{ symbol: string; side: "Buy" | "Sell"; size: string; avgPrice: string }>>(
      "GET", "/v5/position/list", { category: "linear", ...(symbol ? { symbol: symbol.toUpperCase() } : { settleCoin: "USDT" }) }
    );
    return result.list.filter(({ size }) => Number(size) > 0).map((position) => ({
      symbol: position.symbol,
      side: position.side === "Buy" ? "long" : "short",
      qty: number(position.size, "size"),
      entryPrice: number(position.avgPrice, "avgPrice")
    }));
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const result = await this.request<BybitList<{ orderId: string; symbol: string; orderStatus: string }>>(
      "GET", "/v5/order/realtime", { category: "linear", ...(symbol ? { symbol: symbol.toUpperCase() } : { settleCoin: "USDT" }), openOnly: 0 }
    );
    return result.list.map((order) => ({ orderId: order.orderId, symbol: order.symbol, status: order.orderStatus }));
  }

  async closePosition(symbol: string, qty?: number): Promise<OrderAck> {
    const positions = await this.getPositions(symbol);
    const position = positions[0];
    if (!position) throw new Error(`No open position for ${symbol}`);
    return this.placeOrder({
      symbol,
      side: position.side === "long" ? "sell" : "buy",
      type: "market",
      qty: qty ?? position.qty,
      reduceOnly: true,
      orderLinkId: `close-${this.now()}`.slice(0, 36)
    });
  }

  subscribeUserStream(handler: (event: UserEvent) => void): Unsubscribe {
    const socket = new WebSocket(this.privateWsUrl);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    socket.addEventListener("open", () => {
      const expires = this.now() + 10_000;
      const signature = signBybitHmac(this.options.apiSecret, `GET/realtime${expires}`);
      socket.send(JSON.stringify({ op: "auth", args: [this.options.apiKey, expires, signature] }));
      socket.send(JSON.stringify({ op: "subscribe", args: ["order.linear", "execution.linear", "position.linear"] }));
      heartbeat = setInterval(() => socket.send(JSON.stringify({ op: "ping" })), 20_000);
    });
    socket.addEventListener("message", (message) => {
      try {
        const payload: unknown = JSON.parse(String(message.data));
        handler({ type: "bybit", payload });
      } catch {
        handler({ type: "bybit_parse_error", payload: String(message.data) });
      }
    });
    return () => {
      if (heartbeat) clearInterval(heartbeat);
      socket.close();
    };
  }

  async requestDemoFunds(amount: number): Promise<void> {
    if (!this.capabilities.requestDemoFunds) throw new Error("Demo funds are only available for demo accounts");
    await this.request("POST", "/v5/account/demo-apply-money", {
      adjustType: 0,
      utaDemoApplyMoney: [{ coin: "USDT", amountStr: String(amount) }]
    });
  }
}

export function createBybitClient(options: BybitClientOptions): ExchangeClient {
  return new BybitClient(options);
}

