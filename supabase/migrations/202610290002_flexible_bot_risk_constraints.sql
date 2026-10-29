-- =============================================================================
-- Migration: 202610290002_flexible_bot_risk_constraints.sql
-- Description: Expand bot risk limits (risk_per_trade_pct, max_daily_loss_pct,
--              max_drawdown_pct, max_positions, max_leverage) up to 100% / 125x.
-- =============================================================================

alter table public.trading_bots drop constraint if exists trading_bots_risk_per_trade_pct_check;
alter table public.trading_bots add constraint trading_bots_risk_per_trade_pct_check check (risk_per_trade_pct > 0 and risk_per_trade_pct <= 100);

alter table public.trading_bots drop constraint if exists trading_bots_max_daily_loss_pct_check;
alter table public.trading_bots add constraint trading_bots_max_daily_loss_pct_check check (max_daily_loss_pct > 0 and max_daily_loss_pct <= 100);

alter table public.trading_bots drop constraint if exists trading_bots_max_drawdown_pct_check;
alter table public.trading_bots add constraint trading_bots_max_drawdown_pct_check check (max_drawdown_pct > 0 and max_drawdown_pct <= 100);

alter table public.trading_bots drop constraint if exists trading_bots_max_leverage_check;
alter table public.trading_bots add constraint trading_bots_max_leverage_check check (max_leverage between 1 and 125);

alter table public.trading_bots drop constraint if exists trading_bots_max_positions_check;
alter table public.trading_bots add constraint trading_bots_max_positions_check check (max_positions between 1 and 100);
