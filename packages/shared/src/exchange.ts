export type Unsubscribe = () => void;

export interface Balance { equity: number; available: number; currency: string }
export interface InstrumentInfo {
  symbol: string;
  tickSize: number;
  qtyStep: number;
  minQty: number;
  minNotional: number;
  maxLeverage: number;
}
export interface Ticker { symbol: string; lastPrice: number }
export interface OrderRequest {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  qty: number;
  price?: number;
  reduceOnly?: boolean;
  orderLinkId: string;
}
export interface OrderAck { orderId: string; orderLinkId: string }
export interface TradingStopParams {
  symbol: string;
  stopLoss?: number;
  takeProfit?: number;
  trailingStop?: number;
  activePrice?: number;
}
export interface Position { symbol: string; side: "long" | "short"; qty: number; entryPrice: number }
export interface Order { orderId: string; symbol: string; status: string }
export interface UserEvent { type: string; payload: unknown }

export interface ExchangeClient {
  readonly capabilities: { requestDemoFunds: boolean; nativeTrailingStop: boolean };
  getBalance(): Promise<Balance>;
  getInstrument(symbol: string): Promise<InstrumentInfo>;
  getTicker(symbol: string): Promise<Ticker>;
  setLeverage(symbol: string, leverage: number): Promise<void>;
  placeOrder(order: OrderRequest): Promise<OrderAck>;
  cancelOrder(symbol: string, orderId: string): Promise<void>;
  setTradingStop(params: TradingStopParams): Promise<void>;
  getPositions(symbol?: string): Promise<Position[]>;
  getOpenOrders(symbol?: string): Promise<Order[]>;
  closePosition(symbol: string, qty?: number): Promise<OrderAck>;
  subscribeUserStream(handler: (event: UserEvent) => void): Unsubscribe;
  requestDemoFunds?(amount: number): Promise<void>;
}

