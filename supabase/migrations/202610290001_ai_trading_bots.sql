create table if not exists public.trading_bots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.exchange_accounts(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  description text,
  status text not null default 'stopped' check (status in ('running','stopped','paused','error')),
  mode text not null default 'paper' check (mode in ('paper','live')),
  strategy text not null default 'scalping' check (strategy in ('scalping','intraday')),
  allocated_capital numeric not null check (allocated_capital > 0),
  reserve_capital numeric not null default 0 check (reserve_capital >= 0),
  current_balance numeric not null check (current_balance >= 0),
  target_balance numeric check (target_balance is null or target_balance > 0),
  goal_action text not null default 'pause' check (goal_action in ('stop','pause','continue')),
  allowed_symbols text[],
  direction text not null default 'both' check (direction in ('long','short','both')),
  max_positions integer not null default 1 check (max_positions between 1 and 20),
  max_leverage numeric not null default 3 check (max_leverage between 1 and 20),
  risk_per_trade_pct numeric not null default 1 check (risk_per_trade_pct > 0 and risk_per_trade_pct <= 5),
  max_daily_loss_pct numeric not null default 5 check (max_daily_loss_pct > 0 and max_daily_loss_pct <= 25),
  max_drawdown_pct numeric not null default 15 check (max_drawdown_pct > 0 and max_drawdown_pct <= 50),
  max_trades_per_day integer not null default 10 check (max_trades_per_day between 1 and 100),
  autonomous_enabled boolean not null default false,
  live_confirmed_at timestamptz,
  last_heartbeat_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint live_requires_confirmation check (mode = 'paper' or live_confirmed_at is not null),
  constraint capital_reserve check (reserve_capital < allocated_capital)
);

create table if not exists public.bot_decisions (
  id bigint generated always as identity primary key,
  bot_id uuid not null references public.trading_bots(id) on delete cascade,
  cycle_id uuid not null,
  action text not null check (action in ('enter','wait','manage','exit','blocked')),
  symbol text,
  reasoning text not null,
  evidence jsonb not null default '{}'::jsonb,
  signal_id uuid references public.signals(id) on delete set null,
  trade_id uuid references public.trades(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(bot_id, cycle_id)
);

create index if not exists trading_bots_user_idx on public.trading_bots(user_id, created_at desc);
create index if not exists trading_bots_runner_idx on public.trading_bots(status, autonomous_enabled) where status = 'running';
create index if not exists bot_decisions_bot_idx on public.bot_decisions(bot_id, created_at desc);
alter table public.trading_bots enable row level security;
alter table public.bot_decisions enable row level security;
drop policy if exists "users_manage_own_bots" on public.trading_bots;
create policy "users_manage_own_bots" on public.trading_bots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "users_read_own_bot_decisions" on public.bot_decisions;
create policy "users_read_own_bot_decisions" on public.bot_decisions for select using (exists (select 1 from public.trading_bots b where b.id = bot_id and b.user_id = auth.uid()));

create or replace function public.guard_bot_account_owner() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.exchange_accounts a where a.id = new.account_id and a.user_id = new.user_id) then raise exception 'Bot account ownership mismatch'; end if;
  if new.mode = 'paper' and not exists (select 1 from public.exchange_accounts a where a.id = new.account_id and a.exchange = 'paper') then raise exception 'Paper bot requires a paper account'; end if;
  return new;
end $$;
drop trigger if exists trading_bots_account_guard on public.trading_bots;
create trigger trading_bots_account_guard before insert or update on public.trading_bots for each row execute function public.guard_bot_account_owner();
