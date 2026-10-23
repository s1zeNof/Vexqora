export interface ProfileRow {
  id: string;
  display_name: string | null;
  created_at: string;
}

export interface ExchangeAccountRow {
  id: string;
  user_id: string;
  exchange: "paper" | "bybit" | "binance";
  environment: "live" | "demo";
  label: string;
  api_key_enc: string | null;
  api_secret_enc: string | null;
  paper_balance: number | null;
  is_managed: boolean;
  is_active: boolean;
  created_at: string;
}

export interface RiskSettingsRow {
  account_id: string;
  risk_per_trade_pct: number;
  max_leverage: number;
  max_open_positions: number;
  max_daily_loss_pct: number;
  allowed_symbols: string[] | null;
  kill_switch: boolean;
  auto_confirm_telegram: boolean;
}

export interface SignalRow {
  id: string;
  account_id: string;
  raw_text: string | null;
  parsed: Record<string, unknown> | null;
  source: "chat" | "telegram" | "tradingview" | "api";
  status: string;
  reject_reason: string | null;
  created_at: string;
}

export interface TradeRow {
  id: string;
  account_id: string;
  signal_id: string | null;
  symbol: string;
  side: "long" | "short";
  status: string;
  entry_avg: number | null;
  qty: number | null;
  leverage: number | null;
  sl: number | null;
  trailing_stop: Record<string, unknown> | null;
  realized_pnl: number | null;
  opened_at: string | null;
  closed_at: string | null;
  exit_reason: "take_profit" | "stop_loss" | "trailing_stop" | "manual" | "close_all" | "exchange" | null;
  exit_price: number | null;
  exit_details: Record<string, unknown> | null;
}

export interface TradeTargetRow {
  id: string;
  trade_id: string;
  idx: number;
  price: number;
  share_pct: number;
  status: string;
  order_id: string | null;
  filled_at: string | null;
}

export interface OrderRow {
  id: string;
  trade_id: string;
  exchange_order_id: string | null;
  order_link_id: string;
  type: string;
  side: string;
  price: number | null;
  qty: number;
  status: string;
  reduce_only: boolean;
  raw: Record<string, unknown> | null;
}

export interface ChatMessageRow {
  id: string;
  account_id: string;
  role: "user" | "assistant" | "system";
  kind: "signal_input" | "preview" | "confirmation" | "fill" | "alert" | "error" | "cancellation";
  content: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface IntegrationRow {
  id: string;
  user_id: string;
  kind: "telegram" | "discord" | "tradingview";
  config_enc: string | null;
  chat_id: string | null;
  is_active: boolean;
}

export interface AuditLogRow {
  id: number;
  user_id: string;
  account_id: string | null;
  action: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface ExecutionJobRow {
  id: string;
  account_id: string;
  signal_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  attempt_count: number;
  available_at: string;
  locked_at: string | null;
  last_error: string | null;
  created_at: string;
}
