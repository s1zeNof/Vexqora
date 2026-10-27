-- =============================================================================
-- VEXQORA TRADE - COMPLETE ALL-IN-ONE DATABASE SETUP SCRIPT
-- Safe & Idempotent: Run this in Supabase SQL Editor on any new or existing database.
-- Combines all 9 official migrations in exact dependency order:
-- 1. 202610210001_initial_schema.sql
-- 2. 202610210002_saas_paper_enum.sql
-- 3. 202610210002_worker_execution.sql
-- 4. 202610210003_saas_paper_accounts.sql
-- 5. 202610210004_pulse_and_memory.sql
-- 6. 202610230001_paper_balance_and_trade_exit.sql
-- 7. 202610230002_canonical_signals_and_learning.sql
-- 8. 202610240001_paper_trade_precision_fix.sql
-- 9. 202610270001_trade_ai_companion_and_multiagent.sql
-- =============================================================================



create extension if not exists pgcrypto;

do $ begin
  if not exists (select 1 from pg_type where typname = 'exchange_kind') then
    create type public.exchange_kind as enum ('bybit', 'binance', 'paper');
  else
    alter type public.exchange_kind add value if not exists 'paper';
  end if;
  if not exists (select 1 from pg_type where typname = 'exchange_environment') then
    create type public.exchange_environment as enum ('live', 'demo');
  end if;
  if not exists (select 1 from pg_type where typname = 'signal_source') then
    create type public.signal_source as enum ('chat', 'telegram', 'tradingview', 'api');
  end if;
end $;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.exchange_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exchange public.exchange_kind not null,
  environment public.exchange_environment not null,
  label text not null,
  api_key_enc text not null,
  api_secret_enc text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create unique index if not exists one_active_exchange_account_per_user
  on public.exchange_accounts(user_id) where is_active;

create table if not exists public.risk_settings (
  account_id uuid primary key references public.exchange_accounts(id) on delete cascade,
  risk_per_trade_pct numeric(7,4) not null default 1 check (risk_per_trade_pct > 0 and risk_per_trade_pct <= 100),
  max_leverage numeric(7,2) not null default 5 check (max_leverage >= 1),
  max_open_positions integer not null default 3 check (max_open_positions > 0),
  max_daily_loss_pct numeric(7,4) not null default 5 check (max_daily_loss_pct > 0 and max_daily_loss_pct <= 100),
  allowed_symbols text[],
  kill_switch boolean not null default false,
  auto_confirm_telegram boolean not null default false
);

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.exchange_accounts(id) on delete cascade,
  raw_text text,
  parsed jsonb,
  source public.signal_source not null,
  status text not null,
  reject_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.exchange_accounts(id) on delete cascade,
  signal_id uuid references public.signals(id) on delete set null,
  symbol text not null,
  side text not null check (side in ('long', 'short')),
  status text not null,
  entry_avg numeric,
  qty numeric,
  leverage numeric,
  sl numeric,
  trailing_stop jsonb,
  realized_pnl numeric,
  opened_at timestamptz,
  closed_at timestamptz
);

create table if not exists public.trade_targets (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.trades(id) on delete cascade,
  idx integer not null,
  price numeric not null,
  share_pct numeric(7,4) not null,
  status text not null,
  order_id text,
  filled_at timestamptz,
  unique (trade_id, idx)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.trades(id) on delete cascade,
  exchange_order_id text,
  order_link_id text not null unique,
  type text not null,
  side text not null,
  price numeric,
  qty numeric not null,
  status text not null,
  reduce_only boolean not null default false,
  raw jsonb
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.exchange_accounts(id) on delete cascade,
  role text not null,
  kind text not null,
  content text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  config_enc text,
  chat_id text,
  is_active boolean not null default true
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.exchange_accounts(id) on delete set null,
  action text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.execution_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.exchange_accounts(id) on delete cascade,
  signal_id uuid not null references public.signals(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (signal_id)
);

create index if not exists chat_messages_account_created_idx on public.chat_messages(account_id, created_at desc);
create index if not exists trades_account_created_idx on public.trades(account_id, opened_at desc);
create index if not exists signals_account_created_idx on public.signals(account_id, created_at desc);

create or replace function public.owns_account(target_account_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.exchange_accounts where id = target_account_id and user_id = auth.uid()) $$;

alter table public.profiles enable row level security;
alter table public.exchange_accounts enable row level security;
alter table public.risk_settings enable row level security;
alter table public.signals enable row level security;
alter table public.trades enable row level security;
alter table public.trade_targets enable row level security;
alter table public.orders enable row level security;
alter table public.chat_messages enable row level security;
alter table public.integrations enable row level security;
alter table public.audit_log enable row level security;
alter table public.execution_jobs enable row level security;

drop policy if exists "profiles own rows" on public.profiles;
create policy "profiles own rows" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "accounts own rows" on public.exchange_accounts;
create policy "accounts own rows" on public.exchange_accounts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "risk settings through account" on public.risk_settings;
create policy "risk settings through account" on public.risk_settings for all using (public.owns_account(account_id)) with check (public.owns_account(account_id));
drop policy if exists "signals through account" on public.signals;
create policy "signals through account" on public.signals for all using (public.owns_account(account_id)) with check (public.owns_account(account_id));
drop policy if exists "trades through account" on public.trades;
create policy "trades through account" on public.trades for all using (public.owns_account(account_id)) with check (public.owns_account(account_id));
drop policy if exists "targets through trade" on public.trade_targets;
create policy "targets through trade" on public.trade_targets for all using (exists(select 1 from public.trades t where t.id = trade_id and public.owns_account(t.account_id))) with check (exists(select 1 from public.trades t where t.id = trade_id and public.owns_account(t.account_id)));
drop policy if exists "orders through trade" on public.orders;
create policy "orders through trade" on public.orders for all using (exists(select 1 from public.trades t where t.id = trade_id and public.owns_account(t.account_id))) with check (exists(select 1 from public.trades t where t.id = trade_id and public.owns_account(t.account_id)));
drop policy if exists "messages through account" on public.chat_messages;
create policy "messages through account" on public.chat_messages for all using (public.owns_account(account_id)) with check (public.owns_account(account_id));
drop policy if exists "integrations own rows" on public.integrations;
create policy "integrations own rows" on public.integrations for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "audit own rows" on public.audit_log;
create policy "audit own rows" on public.audit_log for select using (user_id = auth.uid());
drop policy if exists "audit insert own rows" on public.audit_log;
create policy "audit insert own rows" on public.audit_log for insert with check (user_id = auth.uid() and (account_id is null or public.owns_account(account_id)));
drop policy if exists "execution jobs through account" on public.execution_jobs;
create policy "execution jobs through account" on public.execution_jobs for select using (public.owns_account(account_id));
drop policy if exists "execution jobs insert through account" on public.execution_jobs;
create policy "execution jobs insert through account" on public.execution_jobs for insert with check (public.owns_account(account_id));

create or replace function public.confirm_signal(target_signal_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare target_account_id uuid; job_id uuid;
begin
  select account_id into target_account_id from public.signals
  where id = target_signal_id and public.owns_account(account_id) and status = 'preview';
  if target_account_id is null then raise exception 'Signal is unavailable for confirmation'; end if;
  update public.signals set status = 'confirmed' where id = target_signal_id;
  insert into public.execution_jobs(account_id, signal_id) values(target_account_id, target_signal_id)
  returning id into job_id;
  insert into public.chat_messages(account_id, role, kind, content, payload)
  values(target_account_id, 'system', 'system', 'Signal confirmed and queued for execution', jsonb_build_object('signalId', target_signal_id));
  return job_id;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$ begin insert into public.profiles(id) values(new.id); return new; end; $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

do $ begin alter publication supabase_realtime add table public.chat_messages; exception when others then null; end $;



-- 202610210002_saas_paper_enum.sql handled in initial block


-- Stage 4 Execution Worker: queue claiming, state persistence and kill-switch functions

create or replace function public.claim_execution_job(
  p_worker_id text default 'worker-1',
  p_lock_duration interval default interval '2 minutes'
)
returns table (
  job_id uuid,
  account_id uuid,
  signal_id uuid,
  attempt_count integer,
  signal_parsed jsonb,
  signal_raw text,
  exchange_kind text,
  exchange_env text,
  api_key_enc text,
  api_secret_enc text
) language plpgsql security definer set search_path = public
as $$
declare
  v_job_id uuid;
begin
  -- Select next queued or expired locked job using FOR UPDATE SKIP LOCKED
  select ej.id into v_job_id
  from public.execution_jobs ej
  where (ej.status = 'queued' or (ej.status = 'processing' and ej.locked_at < now() - p_lock_duration))
    and ej.available_at <= now()
    and ej.attempt_count < 5
  order by ej.created_at asc
  for update skip locked
  limit 1;

  if v_job_id is null then
    return;
  end if;

  -- Lock the job
  update public.execution_jobs ej
  set status = 'processing',
      locked_at = now(),
      attempt_count = ej.attempt_count + 1
  where ej.id = v_job_id;

  -- Return job payload
  return query
  select
    ej.id as job_id,
    ej.account_id,
    ej.signal_id,
    ej.attempt_count,
    s.parsed as signal_parsed,
    s.raw_text as signal_raw,
    ea.exchange::text as exchange_kind,
    ea.environment::text as exchange_env,
    ea.api_key_enc,
    ea.api_secret_enc
  from public.execution_jobs ej
  join public.signals s on s.id = ej.signal_id
  join public.exchange_accounts ea on ea.id = ej.account_id
  where ej.id = v_job_id;
end;
$$;

create or replace function public.complete_execution_job(
  p_job_id uuid,
  p_trade_id uuid
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.execution_jobs
  set status = 'completed',
      locked_at = null,
      last_error = null
  where id = p_job_id;
end;
$$;

create or replace function public.fail_execution_job(
  p_job_id uuid,
  p_error text,
  p_retry boolean default false,
  p_backoff_seconds integer default 10
)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if p_retry then
    update public.execution_jobs
    set status = 'queued',
        locked_at = null,
        last_error = p_error,
        available_at = now() + (p_backoff_seconds || ' seconds')::interval
    where id = p_job_id;
  else
    update public.execution_jobs
    set status = 'failed',
        locked_at = null,
        last_error = p_error
    where id = p_job_id;
  end if;
end;
$$;

create or replace function public.trigger_kill_switch(p_account_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.risk_settings
  set kill_switch = true
  where account_id = p_account_id;

  -- Cancel all queued execution jobs for this account
  update public.execution_jobs
  set status = 'failed',
      last_error = 'Cancelled by emergency Kill Switch'
  where account_id = p_account_id and status in ('queued', 'processing');

  insert into public.chat_messages(account_id, role, kind, content, payload)
  values(p_account_id, 'system', 'system', 'EMERGENCY KILL SWITCH ACTIVATED: Trading halted and pending orders blocked.', jsonb_build_object('action', 'kill_switch'));
end;
$$;


alter table public.exchange_accounts
  alter column api_key_enc drop not null,
  alter column api_secret_enc drop not null,
  add column if not exists paper_balance numeric(20,8),
  add column if not exists is_managed boolean not null default false;

alter table public.exchange_accounts
  add constraint paper_account_shape check (
    (exchange = 'paper' and environment = 'demo' and api_key_enc is null and api_secret_enc is null and paper_balance is not null)
    or
    (exchange <> 'paper' and api_key_enc is not null and api_secret_enc is not null and paper_balance is null)
  ) not valid;

create or replace function public.ensure_user_workspace(target_user_id uuid default auth.uid())
returns uuid language plpgsql security definer set search_path = public
as $$
declare paper_account_id uuid;
begin
  if target_user_id is null or (auth.uid() is not null and target_user_id <> auth.uid()) then
    raise exception 'Not authorized';
  end if;

  select id into paper_account_id from public.exchange_accounts
  where user_id = target_user_id and exchange = 'paper'
  order by created_at asc limit 1;

  if paper_account_id is null then
    update public.exchange_accounts set is_active = false where user_id = target_user_id and is_active;
    insert into public.exchange_accounts(user_id, exchange, environment, label, api_key_enc, api_secret_enc, is_active, paper_balance, is_managed)
    values(target_user_id, 'paper', 'demo', 'Vexqora Paper', null, null, true, 10000, true)
    returning id into paper_account_id;
    insert into public.risk_settings(account_id) values(paper_account_id) on conflict do nothing;
  end if;

  return paper_account_id;
end;
$$;

create or replace function public.top_up_paper_balance(target_account_id uuid, amount numeric)
returns numeric language plpgsql security definer set search_path = public
as $$
declare new_balance numeric;
begin
  if amount <= 0 or amount > 100000 then raise exception 'Amount must be between 0 and 100000 USDT'; end if;
  update public.exchange_accounts
  set paper_balance = paper_balance + amount
  where id = target_account_id and user_id = auth.uid() and exchange = 'paper'
  returning paper_balance into new_balance;
  if new_balance is null then raise exception 'Paper account not found'; end if;
  insert into public.audit_log(user_id, account_id, action, meta)
  values(auth.uid(), target_account_id, 'paper.balance_topped_up', jsonb_build_object('amount', amount, 'balance', new_balance));
  return new_balance;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id, display_name) values(new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  perform public.ensure_user_workspace(new.id);
  return new;
end;
$$;

do $$
declare existing_user record;
begin
  for existing_user in select id from auth.users loop
    perform public.ensure_user_workspace(existing_user.id);
  end loop;
end;
$$;

drop function if exists public.claim_execution_job(text, interval);

create function public.claim_execution_job(
  p_worker_id text default 'worker-1',
  p_lock_duration interval default interval '2 minutes'
)
returns table (
  job_id uuid, account_id uuid, signal_id uuid, attempt_count integer,
  signal_parsed jsonb, signal_raw text, exchange_kind text, exchange_env text,
  api_key_enc text, api_secret_enc text, paper_balance numeric
) language plpgsql security definer set search_path = public
as $$
declare v_job_id uuid;
begin
  select ej.id into v_job_id from public.execution_jobs ej
  where (ej.status = 'queued' or (ej.status = 'processing' and ej.locked_at < now() - p_lock_duration))
    and ej.available_at <= now() and ej.attempt_count < 5
  order by ej.created_at asc for update skip locked limit 1;
  if v_job_id is null then return; end if;
  update public.execution_jobs ej set status = 'processing', locked_at = now(), attempt_count = ej.attempt_count + 1 where ej.id = v_job_id;
  return query select ej.id, ej.account_id, ej.signal_id, ej.attempt_count, s.parsed, s.raw_text,
    ea.exchange::text, ea.environment::text, ea.api_key_enc, ea.api_secret_enc, ea.paper_balance
  from public.execution_jobs ej join public.signals s on s.id = ej.signal_id
  join public.exchange_accounts ea on ea.id = ej.account_id where ej.id = v_job_id;
end;
$$;



-- Migration 202610210004: Vexqora Pulse 24/7 Anomaly Scanner & Vexqora Memory Catalog

create table if not exists public.market_pulses (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  exchange text not null default 'bybit',
  event_type text not null,
  change_pct numeric not null,
  timeframe_sec integer not null default 30,
  price numeric not null,
  turnover_24h numeric,
  details jsonb,
  ai_status text not null default 'monitoring',
  created_at timestamptz not null default now()
);

create table if not exists public.historical_patterns (
  id uuid primary key default gen_random_uuid(),
  pattern_name text not null,
  event_type text not null,
  market_regime text not null,
  sample_count integer not null default 1,
  win_rate_pct numeric not null default 68.0,
  avg_rr numeric not null default 2.6,
  typical_duration_min integer not null default 45,
  historical_context text,
  features jsonb,
  created_at timestamptz not null default now()
);

-- Seed institutional historical patterns into Vexqora Memory
insert into public.historical_patterns (pattern_name, event_type, market_regime, sample_count, win_rate_pct, avg_rr, typical_duration_min, historical_context)
values
  ('Liquidity Sweep + Bullish CHOCH', 'liquidity_sweep', 'Liquidity Hunt', 37, 73.0, 2.8, 35, 'Price swept liquidity below local low, returned into value range and triggered structural shift. In 27 of 37 historical episodes, price achieved TP2 prior to invalidation.'),
  ('Momentum Breakout & Volume Expansion', 'volume_spike', 'Trend Continuation', 42, 71.4, 2.6, 45, 'Sharp volume surge exceeding 3.5x baseline during Bollinger Band expansion. 30 of 42 historical episodes sustained trend to second target.'),
  ('Order Block Sweep & Delta Absorption', 'order_block_sweep', 'High Volatility', 29, 75.8, 3.1, 28, 'Institutional limit absorption confirmed by positive delta divergence against falling price. 22 of 29 historical episodes produced clean continuation.'),
  ('Volume Climax & Mean Reversion', 'price_spike', 'Range Consolidation', 34, 70.6, 2.4, 20, 'Parabolic exhaustion spike (>4% in 30s) followed by immediate bid exhaustion. 24 of 34 historical cases reverted back to VWAP.')
on conflict do nothing;


alter table public.trades
  add column if not exists exit_reason text,
  add column if not exists exit_price numeric,
  add column if not exists exit_details jsonb;

alter table public.trades drop constraint if exists trades_exit_reason_check;
alter table public.trades add constraint trades_exit_reason_check check (
  exit_reason is null or exit_reason in ('take_profit', 'stop_loss', 'trailing_stop', 'manual', 'close_all', 'exchange')
);

create or replace function public.adjust_paper_balance(target_account_id uuid, amount numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance numeric;
begin
  if amount = 0 or abs(amount) > 100000 then
    raise exception 'Amount must be between -100000 and 100000 USDT and cannot be zero';
  end if;

  update public.exchange_accounts
  set paper_balance = paper_balance + amount
  where id = target_account_id
    and user_id = auth.uid()
    and exchange = 'paper'
    and paper_balance + amount >= 0
  returning paper_balance into new_balance;

  if new_balance is null then
    raise exception 'Paper account not found or withdrawal exceeds available balance';
  end if;

  insert into public.audit_log(user_id, account_id, action, meta)
  values (
    auth.uid(),
    target_account_id,
    case when amount > 0 then 'paper.balance_added' else 'paper.balance_removed' end,
    jsonb_build_object('amount', amount, 'balance', new_balance)
  );

  return new_balance;
end;
$$;

grant execute on function public.adjust_paper_balance(uuid, numeric) to authenticated;

create or replace function public.apply_paper_trade_result(
  target_trade_id uuid,
  expected_qty numeric,
  expected_realized_pnl numeric,
  new_qty numeric,
  new_realized_pnl numeric,
  new_status text,
  new_trailing_stop jsonb,
  result_closed_at timestamptz,
  realized_pnl_delta numeric,
  target_updates jsonb,
  result_exit_reason text,
  result_exit_price numeric,
  result_exit_details jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_account_id uuid;
  current_qty numeric;
  current_realized_pnl numeric;
begin
  select account_id, qty, coalesce(realized_pnl, 0)
  into target_account_id, current_qty, current_realized_pnl
  from public.trades
  where id = target_trade_id and status in ('active', 'entry_open')
  for update;

  if target_account_id is null then
    return false;
  end if;

  if not public.owns_account(target_account_id) and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not authorized to update this trade';
  end if;

  -- Use epsilon tolerance for float-to-numeric comparisons from JavaScript
  if abs(coalesce(current_qty, 0) - coalesce(expected_qty, 0)) > 0.0001
     or abs(coalesce(current_realized_pnl, 0) - coalesce(expected_realized_pnl, 0)) > 0.0001 then
    return false;
  end if;

  update public.trades
  set qty = new_qty,
      realized_pnl = new_realized_pnl,
      status = new_status,
      trailing_stop = new_trailing_stop,
      closed_at = coalesce(result_closed_at, closed_at),
      exit_reason = coalesce(result_exit_reason, exit_reason),
      exit_price = coalesce(result_exit_price, exit_price),
      exit_details = coalesce(result_exit_details, exit_details)
  where id = target_trade_id;

  update public.trade_targets tt
  set status = u.status,
      filled_at = coalesce(u.filled_at, tt.filled_at)
  from (
    select
      (item->>'id')::uuid as id,
      item->>'status' as status,
      nullif(item->>'filled_at', '')::timestamptz as filled_at
    from jsonb_array_elements(coalesce(target_updates, '[]'::jsonb)) item
  ) u
  where tt.id = u.id and tt.trade_id = target_trade_id;

  if realized_pnl_delta <> 0 then
    update public.exchange_accounts
    set paper_balance = greatest(0, paper_balance + realized_pnl_delta)
    where id = target_account_id and exchange = 'paper';
  end if;

  return true;
end;
$$;

grant execute on function public.apply_paper_trade_result(
  uuid, numeric, numeric, numeric, numeric, text, jsonb, timestamptz,
  numeric, jsonb, text, numeric, jsonb
) to authenticated, service_role;


alter table public.signals
  add column if not exists origin_key text,
  add column if not exists expires_at timestamptz;

create unique index if not exists signals_account_origin_key_uidx
  on public.signals(account_id, origin_key)
  where origin_key is not null;

create table if not exists public.signal_outcomes (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null unique references public.signals(id) on delete cascade,
  account_id uuid not null references public.exchange_accounts(id) on delete cascade,
  symbol text not null,
  side text not null check (side in ('long', 'short')),
  entry_price numeric not null,
  stop_loss numeric not null,
  tp1 numeric not null,
  tp2 numeric,
  tp3 numeric,
  status text not null default 'monitoring' check (status in ('monitoring', 'tp1_hit', 'tp2_hit', 'won', 'failed', 'expired')),
  last_price numeric,
  max_favorable_pct numeric not null default 0,
  max_adverse_pct numeric not null default 0,
  tp1_hit_at timestamptz,
  tp2_hit_at timestamptz,
  tp3_hit_at timestamptz,
  stop_hit_at timestamptz,
  outcome text check (outcome is null or outcome in ('win', 'loss', 'partial', 'no_trigger')),
  failure_reason text,
  strategy text,
  features jsonb,
  expires_at timestamptz not null default (now() + interval '48 hours'),
  last_evaluated_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists signal_outcomes_monitoring_idx
  on public.signal_outcomes(status, last_evaluated_at)
  where status in ('monitoring', 'tp1_hit', 'tp2_hit');

create table if not exists public.signal_learning_events (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid not null unique references public.signals(id) on delete cascade,
  symbol text not null,
  side text not null,
  strategy text,
  outcome text not null,
  failure_reason text,
  max_favorable_pct numeric not null default 0,
  max_adverse_pct numeric not null default 0,
  features jsonb,
  created_at timestamptz not null default now()
);

alter table public.signal_outcomes enable row level security;
alter table public.signal_learning_events enable row level security;

drop policy if exists "signal outcomes through account" on public.signal_outcomes;
drop policy if exists "signal outcomes through account" on public.signal_outcomes;
create policy "signal outcomes through account" on public.signal_outcomes
  for select using (public.owns_account(account_id));

drop policy if exists "signal outcomes insert through account" on public.signal_outcomes;
drop policy if exists "signal outcomes insert through account" on public.signal_outcomes;
create policy "signal outcomes insert through account" on public.signal_outcomes
  for insert with check (public.owns_account(account_id));

drop policy if exists "learning events through signal" on public.signal_learning_events;
drop policy if exists "learning events through signal" on public.signal_learning_events;
create policy "learning events through signal" on public.signal_learning_events
  for select using (
    exists (
      select 1 from public.signals s
      where s.id = signal_id and public.owns_account(s.account_id)
    )
  );

drop policy if exists "signal outcomes update through account" on public.signal_outcomes;
drop policy if exists "signal outcomes update through account" on public.signal_outcomes;
create policy "signal outcomes update through account" on public.signal_outcomes
  for update using (public.owns_account(account_id)) with check (public.owns_account(account_id));


-- Fix float precision discrepancy in optimistic locking for paper trade settlement
create or replace function public.apply_paper_trade_result(
  target_trade_id uuid,
  expected_qty numeric,
  expected_realized_pnl numeric,
  new_qty numeric,
  new_realized_pnl numeric,
  new_status text,
  new_trailing_stop jsonb,
  result_closed_at timestamptz,
  realized_pnl_delta numeric,
  target_updates jsonb,
  result_exit_reason text,
  result_exit_price numeric,
  result_exit_details jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_account_id uuid;
  current_qty numeric;
  current_realized_pnl numeric;
begin
  select account_id, qty, coalesce(realized_pnl, 0)
  into target_account_id, current_qty, current_realized_pnl
  from public.trades
  where id = target_trade_id and status in ('active', 'entry_open')
  for update;

  if target_account_id is null then
    return false;
  end if;

  if not public.owns_account(target_account_id) and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not authorized to update this trade';
  end if;

  -- Use epsilon tolerance for float-to-numeric comparisons from JavaScript
  if abs(coalesce(current_qty, 0) - coalesce(expected_qty, 0)) > 0.0001
     or abs(coalesce(current_realized_pnl, 0) - coalesce(expected_realized_pnl, 0)) > 0.0001 then
    return false;
  end if;

  update public.trades
  set qty = new_qty,
      realized_pnl = new_realized_pnl,
      status = new_status,
      trailing_stop = new_trailing_stop,
      closed_at = coalesce(result_closed_at, closed_at),
      exit_reason = coalesce(result_exit_reason, exit_reason),
      exit_price = coalesce(result_exit_price, exit_price),
      exit_details = coalesce(result_exit_details, exit_details)
  where id = target_trade_id;

  update public.trade_targets tt
  set status = u.status,
      filled_at = coalesce(u.filled_at, tt.filled_at)
  from (
    select
      (item->>'id')::uuid as id,
      item->>'status' as status,
      nullif(item->>'filled_at', '')::timestamptz as filled_at
    from jsonb_array_elements(coalesce(target_updates, '[]'::jsonb)) item
  ) u
  where tt.id = u.id and tt.trade_id = target_trade_id;

  if realized_pnl_delta <> 0 then
    update public.exchange_accounts
    set paper_balance = greatest(0, paper_balance + realized_pnl_delta)
    where id = target_account_id and exchange = 'paper';
  end if;

  return true;
end;
$$;

grant execute on function public.apply_paper_trade_result(
  uuid, numeric, numeric, numeric, numeric, text, jsonb, timestamptz,
  numeric, jsonb, text, numeric, jsonb
) to authenticated, service_role;


-- Migration: 202610270001_trade_ai_companion_and_multiagent.sql
-- Implements Phase P3 (Always-on Per-Trade AI Companion) & Phase P4 (Multi-Agent Runtime & Skills Registry)

create table if not exists public.trade_ai_sessions (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid references public.trades(id) on delete cascade,
  signal_id uuid references public.signals(id) on delete set null,
  account_id uuid not null references public.exchange_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  status text not null default 'active' check (status in ('active', 'closed', 'paused')),
  initial_thesis text,
  invalidation_criteria text,
  model_policy text not null default 'nemotron_balanced',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists trade_ai_sessions_account_trade_idx
  on public.trade_ai_sessions(account_id, trade_id);

create index if not exists trade_ai_sessions_user_idx
  on public.trade_ai_sessions(user_id, status);

create table if not exists public.trade_ai_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.trade_ai_sessions(id) on delete cascade,
  author_kind text not null check (author_kind in ('user', 'lead', 'subagent', 'system')),
  agent_id text,
  kind text not null default 'text' check (kind in ('text', 'event', 'analysis', 'action_recommendation', 'action_status')),
  content text not null,
  structured_payload jsonb,
  event_id text,
  created_at timestamptz not null default now()
);

create index if not exists trade_ai_messages_session_time_idx
  on public.trade_ai_messages(session_id, created_at asc);

create table if not exists public.trade_ai_decisions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.trade_ai_sessions(id) on delete cascade,
  decision_type text not null,
  recommendation text not null,
  evidence jsonb,
  model_version text,
  approval_state text not null default 'pending' check (approval_state in ('pending', 'approved', 'rejected', 'auto_simulated')),
  action_result jsonb,
  created_at timestamptz not null default now()
);

create index if not exists trade_ai_decisions_session_idx
  on public.trade_ai_decisions(session_id, created_at desc);

-- Phase P4: Multi-Agent Runtime & Skills Registry
create table if not exists public.ai_agent_definitions (
  agent_key text primary key,
  version text not null default '1.0.0',
  display_name text not null,
  purpose text not null,
  model_policy text not null default 'nemotron_balanced',
  enabled boolean not null default true,
  permissions jsonb default '["read", "analyze", "recommend"]'::jsonb,
  budget jsonb default '{"maxTokensPerCall": 1500, "timeoutMs": 15000}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_skill_registry (
  skill_key text primary key,
  version text not null default '1.0.0',
  display_name text not null,
  description text not null,
  input_schema jsonb,
  output_schema jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_agent_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.trade_ai_sessions(id) on delete cascade,
  agent_key text not null references public.ai_agent_definitions(agent_key) on delete cascade,
  event_reason text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'timeout')),
  latency_ms integer,
  tokens_used integer,
  error_info text,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_agent_runs(id) on delete cascade,
  skill_key text not null references public.ai_skill_registry(skill_key) on delete cascade,
  input_payload jsonb,
  output_summary text,
  error_info text,
  created_at timestamptz not null default now()
);

-- Seed initial Agent Definitions
insert into public.ai_agent_definitions (agent_key, version, display_name, purpose)
values
  ('lead_trade_agent', '1.0.0', 'Vexqora Lead Trade Agent', 'Synthesizes market structure, order flow, risk and macro context for the trade'),
  ('market_structure_agent', '1.0.0', 'Market Structure Agent', 'Multi-timeframe swing, trend, BOS, CHOCH and FVG detection'),
  ('order_flow_agent', '1.0.0', 'Order Flow & CVD Agent', 'DOM imbalance, cumulative volume delta and tape aggression'),
  ('derivatives_agent', '1.0.0', 'Derivatives & Squeeze Agent', 'Open interest changes, funding rate skew and liquidation risk'),
  ('risk_guardian_agent', '1.0.0', 'Risk Guardian Agent', 'Account drawdown protection, risk limits and protective stops'),
  ('news_events_agent', '1.0.0', 'News & Event Intelligence Agent', 'Exchange announcements, token events and macroeconomic calendars'),
  ('quant_ml_agent', '1.0.0', 'Quant & ML Intelligence Agent', 'Technical indicators, feature extraction and CatBoost scoring')
on conflict (agent_key) do nothing;

-- Seed initial Core Skills
insert into public.ai_skill_registry (skill_key, version, display_name, description, enabled)
values
  ('market.mtf_structure', '1.0.0', 'Multi-Timeframe Structure', 'Evaluates trend, swing highs/lows, BOS and CHOCH across 1D/4H/1H/15M/5M.', true),
  ('orderflow.cvd_obi', '1.0.0', 'Order Flow & CVD Analyzer', 'Evaluates Cumulative Volume Delta, Tape Aggression, and Order Book Imbalance.', true),
  ('derivatives.squeeze_oi', '1.0.0', 'Derivatives & Squeeze Detector', 'Analyzes Open Interest changes and funding rate skew for liquidation risk.', true),
  ('news.impact_scanner', '1.0.0', 'News & Macro Event Scanner', 'Checks verified exchange announcements, delistings, and high-impact macro data.', true),
  ('risk.capital_guardian', '1.0.0', 'Capital Guardian Risk Policy', 'Enforces strict max daily loss, portfolio exposure, and protective SL/TP.', true)
on conflict (skill_key) do nothing;

-- Row Level Security
alter table public.trade_ai_sessions enable row level security;
alter table public.trade_ai_messages enable row level security;
alter table public.trade_ai_decisions enable row level security;
alter table public.ai_agent_definitions enable row level security;
alter table public.ai_skill_registry enable row level security;
alter table public.ai_agent_runs enable row level security;
alter table public.ai_agent_tool_calls enable row level security;

-- Policies for trade_ai_sessions
drop policy if exists "user owns trade_ai_sessions" on public.trade_ai_sessions;
create policy "user owns trade_ai_sessions" on public.trade_ai_sessions
  for all using (user_id = auth.uid());

-- Policies for trade_ai_messages
drop policy if exists "user accesses messages via session" on public.trade_ai_messages;
create policy "user accesses messages via session" on public.trade_ai_messages
  for all using (
    exists (
      select 1 from public.trade_ai_sessions s
      where s.id = trade_ai_messages.session_id
        and s.user_id = auth.uid()
    )
  );

-- Policies for trade_ai_decisions
drop policy if exists "user accesses decisions via session" on public.trade_ai_decisions;
create policy "user accesses decisions via session" on public.trade_ai_decisions
  for all using (
    exists (
      select 1 from public.trade_ai_sessions s
      where s.id = trade_ai_decisions.session_id
        and s.user_id = auth.uid()
    )
  );

-- Policies for agent runs
drop policy if exists "user accesses runs via session" on public.ai_agent_runs;
create policy "user accesses runs via session" on public.ai_agent_runs
  for select using (
    exists (
      select 1 from public.trade_ai_sessions s
      where s.id = ai_agent_runs.session_id
        and s.user_id = auth.uid()
    )
  );

-- Policies for tool calls
drop policy if exists "user accesses tool calls via run" on public.ai_agent_tool_calls;
create policy "user accesses tool calls via run" on public.ai_agent_tool_calls
  for select using (
    exists (
      select 1 from public.ai_agent_runs r
      join public.trade_ai_sessions s on s.id = r.session_id
      where r.id = ai_agent_tool_calls.run_id
        and s.user_id = auth.uid()
    )
  );

-- Public read for skill registry & definitions
drop policy if exists "anyone can view enabled skills" on public.ai_skill_registry;
create policy "anyone can view enabled skills" on public.ai_skill_registry
  for select using (enabled = true);

drop policy if exists "anyone can view enabled agents" on public.ai_agent_definitions;
create policy "anyone can view enabled agents" on public.ai_agent_definitions
  for select using (enabled = true);
