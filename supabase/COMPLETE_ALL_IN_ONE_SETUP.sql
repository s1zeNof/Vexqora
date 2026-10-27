-- =============================================================================
-- VEXQORA TRADE - COMPLETE ALL-IN-ONE DATABASE SETUP SCRIPT
-- Safe & Idempotent: Run this in Supabase SQL Editor on any new or existing database.
-- Combines all schema components and migrations from 20261021 through 20261027.
-- =============================================================================

create extension if not exists pgcrypto;

-- 1. ENUMS (Safe creation)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'exchange_kind') then
    create type public.exchange_kind as enum ('bybit', 'binance', 'paper');
  else
    alter type public.exchange_kind add value if not exists 'paper';
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'exchange_environment') then
    create type public.exchange_environment as enum ('live', 'demo');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'signal_source') then
    create type public.signal_source as enum ('chat', 'telegram', 'tradingview', 'api');
  end if;
end $$;

-- 2. CORE TABLES
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
  paper_balance_usdt numeric not null default 1000 check (paper_balance_usdt >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

alter table public.exchange_accounts add column if not exists paper_balance_usdt numeric not null default 1000 check (paper_balance_usdt >= 0);

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
  exit_reason text,
  exit_price numeric,
  exit_details jsonb,
  opened_at timestamptz,
  closed_at timestamptz
);

alter table public.trades add column if not exists exit_reason text;
alter table public.trades add column if not exists exit_price numeric;
alter table public.trades add column if not exists exit_details jsonb;

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

-- PULSE & PATTERNS
create table if not exists public.market_pulses (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  interval text not null,
  volatility_score numeric not null,
  trend_direction text not null check (trend_direction in ('bullish', 'bearish', 'neutral')),
  support_level numeric,
  resistance_level numeric,
  meta jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.historical_patterns (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  pattern_type text not null,
  confidence numeric not null,
  direction text not null check (direction in ('long', 'short')),
  expected_move_pct numeric,
  source_features jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  was_successful boolean
);

-- SIGNAL OUTCOMES & LEARNING
create table if not exists public.signal_outcomes (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references public.signals(id) on delete cascade,
  trade_id uuid references public.trades(id) on delete cascade,
  symbol text not null,
  direction text not null check (direction in ('long', 'short')),
  entry_price numeric not null,
  exit_price numeric,
  pnl_pct numeric,
  pnl_usdt numeric,
  outcome text not null check (outcome in ('win', 'loss', 'breakeven', 'cancelled', 'timeout')),
  hit_targets integer[] default array[]::integer[],
  max_favorable_excursion_pct numeric,
  max_adverse_excursion_pct numeric,
  holding_duration_seconds integer,
  market_regime text,
  market_volatility_pct numeric,
  features_at_entry jsonb,
  ml_predicted_win_rate numeric,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.signal_learning_events (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references public.signals(id) on delete cascade,
  event_type text not null,
  description text not null,
  adjustment_proposed text,
  was_applied boolean default false,
  metrics_payload jsonb,
  created_at timestamptz not null default now()
);

-- AI COMPANION & MULTIAGENT TABLES
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

create table if not exists public.ai_agent_definitions (
  agent_key text primary key,
  version text not null default '1.0.0',
  display_name text not null,
  purpose text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_skill_registry (
  skill_key text primary key,
  version text not null default '1.0.0',
  display_name text not null,
  description text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_agent_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.trade_ai_sessions(id) on delete cascade,
  agent_key text not null references public.ai_agent_definitions(agent_key) on delete cascade,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'timeout')),
  evidence_collected jsonb,
  summary text,
  latency_ms integer,
  token_usage integer,
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

-- INDEXES
create index if not exists chat_messages_account_created_idx on public.chat_messages (account_id, created_at desc);
create index if not exists execution_jobs_claim_idx on public.execution_jobs (status, available_at, attempt_count);
create index if not exists market_pulses_symbol_created_idx on public.market_pulses (symbol, created_at desc);
create index if not exists historical_patterns_symbol_detected_idx on public.historical_patterns (symbol, detected_at desc);
create index if not exists signal_outcomes_symbol_outcome_idx on public.signal_outcomes(symbol, outcome);
create index if not exists signal_outcomes_resolved_at_idx on public.signal_outcomes(resolved_at desc);
create index if not exists signal_learning_events_signal_idx on public.signal_learning_events(signal_id);
create index if not exists trade_ai_sessions_account_trade_idx on public.trade_ai_sessions(account_id, trade_id);
create index if not exists trade_ai_sessions_user_idx on public.trade_ai_sessions(user_id, status);
create index if not exists trade_ai_messages_session_time_idx on public.trade_ai_messages(session_id, created_at asc);

-- FUNCTIONS & RPC
create or replace function public.claim_execution_job(p_worker_id text, p_lock_seconds int default 30)
returns table (
  id uuid,
  account_id uuid,
  signal_id uuid,
  attempt_count int
)
language plpgsql
security definer
as $$
declare
  v_job record;
begin
  select j.id, j.account_id, j.signal_id, j.attempt_count
  into v_job
  from public.execution_jobs j
  where (j.status = 'queued' and j.available_at <= now())
     or (j.status = 'processing' and j.locked_at < now() - make_interval(secs => p_lock_seconds))
  order by j.available_at asc, j.created_at asc
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  update public.execution_jobs
  set status = 'processing',
      locked_at = now(),
      attempt_count = attempt_count + 1
  where public.execution_jobs.id = v_job.id;

  return query
  select v_job.id, v_job.account_id, v_job.signal_id, v_job.attempt_count + 1;
end;
$$;

create or replace function public.ensure_user_paper_account(p_user_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_account_id uuid;
  v_active_exists boolean;
begin
  select exists (
    select 1
    from public.exchange_accounts
    where user_id = p_user_id
      and is_active = true
  ) into v_active_exists;

  select id into v_account_id
  from public.exchange_accounts
  where user_id = p_user_id
    and exchange = 'paper'
    and environment = 'demo'
  order by created_at asc
  limit 1;

  if v_account_id is null then
    insert into public.exchange_accounts (
      user_id,
      exchange,
      environment,
      label,
      api_key_enc,
      api_secret_enc,
      is_active,
      paper_balance_usdt
    ) values (
      p_user_id,
      'paper',
      'demo',
      'Vexqora Paper',
      '',
      '',
      not v_active_exists,
      1000
    ) returning id into v_account_id;

    insert into public.risk_settings (
      account_id,
      risk_per_trade_pct,
      max_leverage,
      max_open_positions,
      max_daily_loss_pct,
      allowed_symbols,
      kill_switch,
      auto_confirm_telegram
    ) values (
      v_account_id,
      1,
      10,
      3,
      5,
      null,
      false,
      false
    ) on conflict (account_id) do nothing;
  end if;

  return v_account_id;
end;
$$;

create or replace function public.adjust_paper_account_balance(
  p_account_id uuid,
  p_delta_usdt numeric
)
returns table (
  account_id uuid,
  previous_balance_usdt numeric,
  new_balance_usdt numeric
)
language plpgsql
security definer
as $$
declare
  v_account public.exchange_accounts%rowtype;
  v_new_balance numeric;
  v_delta numeric;
begin
  v_delta := round(coalesce(p_delta_usdt, 0), 4);

  select *
  into v_account
  from public.exchange_accounts
  where id = p_account_id
    and exchange = 'paper'
  for update;

  if not found then
    raise exception 'Paper account % not found', p_account_id;
  end if;

  v_new_balance := round(v_account.paper_balance_usdt + v_delta, 4);

  if v_new_balance < 0 then
    raise exception 'Insufficient paper funds: balance % is less than required %', v_account.paper_balance_usdt, abs(v_delta);
  end if;

  update public.exchange_accounts
  set paper_balance_usdt = v_new_balance
  where id = p_account_id;

  return query
  select p_account_id, v_account.paper_balance_usdt, v_new_balance;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;

  perform public.ensure_user_paper_account(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- SEED DATA FOR AGENTS & SKILLS
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

insert into public.ai_skill_registry (skill_key, version, display_name, description, enabled)
values
  ('market.mtf_structure', '1.0.0', 'Multi-Timeframe Structure', 'Evaluates trend, swing highs/lows, BOS and CHOCH across 1D/4H/1H/15M/5M.', true),
  ('orderflow.cvd_obi', '1.0.0', 'Order Flow & CVD Analyzer', 'Evaluates Cumulative Volume Delta, Tape Aggression, and Order Book Imbalance.', true),
  ('derivatives.squeeze_oi', '1.0.0', 'Derivatives & Squeeze Detector', 'Analyzes Open Interest changes and funding rate skew for liquidation risk.', true),
  ('news.impact_scanner', '1.0.0', 'News & Macro Event Scanner', 'Checks verified exchange announcements, delistings, and high-impact macro data.', true),
  ('risk.capital_guardian', '1.0.0', 'Capital Guardian Risk Policy', 'Enforces strict max daily loss, portfolio exposure, and protective SL/TP.', true)
on conflict (skill_key) do nothing;

-- ROW LEVEL SECURITY (RLS)
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
alter table public.market_pulses enable row level security;
alter table public.historical_patterns enable row level security;
alter table public.signal_outcomes enable row level security;
alter table public.signal_learning_events enable row level security;
alter table public.trade_ai_sessions enable row level security;
alter table public.trade_ai_messages enable row level security;
alter table public.trade_ai_decisions enable row level security;
alter table public.ai_agent_definitions enable row level security;
alter table public.ai_skill_registry enable row level security;
alter table public.ai_agent_runs enable row level security;
alter table public.ai_agent_tool_calls enable row level security;

-- POLICIES
drop policy if exists "Users view own profile" on public.profiles;
create policy "Users view own profile" on public.profiles for select using (auth.uid() = id);

drop policy if exists "Users manage own exchange accounts" on public.exchange_accounts;
create policy "Users manage own exchange accounts" on public.exchange_accounts for all using (auth.uid() = user_id);

drop policy if exists "Users manage own risk settings" on public.risk_settings;
create policy "Users manage own risk settings" on public.risk_settings for all using (
  exists (select 1 from public.exchange_accounts a where a.id = account_id and a.user_id = auth.uid())
);

drop policy if exists "Users manage own signals" on public.signals;
create policy "Users manage own signals" on public.signals for all using (
  exists (select 1 from public.exchange_accounts a where a.id = account_id and a.user_id = auth.uid())
);

drop policy if exists "Users manage own trades" on public.trades;
create policy "Users manage own trades" on public.trades for all using (
  exists (select 1 from public.exchange_accounts a where a.id = account_id and a.user_id = auth.uid())
);

drop policy if exists "Users manage own trade targets" on public.trade_targets;
create policy "Users manage own trade targets" on public.trade_targets for all using (
  exists (select 1 from public.trades t join public.exchange_accounts a on a.id = t.account_id where t.id = trade_id and a.user_id = auth.uid())
);

drop policy if exists "Users manage own orders" on public.orders;
create policy "Users manage own orders" on public.orders for all using (
  exists (select 1 from public.trades t join public.exchange_accounts a on a.id = t.account_id where t.id = trade_id and a.user_id = auth.uid())
);

drop policy if exists "Users manage own chat messages" on public.chat_messages;
create policy "Users manage own chat messages" on public.chat_messages for all using (
  exists (select 1 from public.exchange_accounts a where a.id = account_id and a.user_id = auth.uid())
);

drop policy if exists "Users manage own integrations" on public.integrations;
create policy "Users manage own integrations" on public.integrations for all using (auth.uid() = user_id);

drop policy if exists "Users view own audit log" on public.audit_log;
create policy "Users view own audit log" on public.audit_log for select using (auth.uid() = user_id);

drop policy if exists "Users view own pulses" on public.market_pulses;
create policy "Users view own pulses" on public.market_pulses for select using (true);

drop policy if exists "Users view own patterns" on public.historical_patterns;
create policy "Users view own patterns" on public.historical_patterns for select using (true);

drop policy if exists "user accesses signal outcomes via account" on public.signal_outcomes;
create policy "user accesses signal outcomes via account" on public.signal_outcomes for all using (
  exists (
    select 1 from public.signals s
    join public.exchange_accounts a on a.id = s.account_id
    where s.id = signal_outcomes.signal_id and a.user_id = auth.uid()
  )
);

drop policy if exists "user accesses signal learning via signal" on public.signal_learning_events;
create policy "user accesses signal learning via signal" on public.signal_learning_events for all using (
  exists (
    select 1 from public.signals s
    join public.exchange_accounts a on a.id = s.account_id
    where s.id = signal_learning_events.signal_id and a.user_id = auth.uid()
  )
);

drop policy if exists "user owns trade_ai_sessions" on public.trade_ai_sessions;
create policy "user owns trade_ai_sessions" on public.trade_ai_sessions for all using (user_id = auth.uid());

drop policy if exists "user accesses messages via session" on public.trade_ai_messages;
create policy "user accesses messages via session" on public.trade_ai_messages for all using (
  exists (select 1 from public.trade_ai_sessions s where s.id = trade_ai_messages.session_id and s.user_id = auth.uid())
);

drop policy if exists "user accesses decisions via session" on public.trade_ai_decisions;
create policy "user accesses decisions via session" on public.trade_ai_decisions for all using (
  exists (select 1 from public.trade_ai_sessions s where s.id = trade_ai_decisions.session_id and s.user_id = auth.uid())
);

drop policy if exists "user accesses runs via session" on public.ai_agent_runs;
create policy "user accesses runs via session" on public.ai_agent_runs for select using (
  exists (select 1 from public.trade_ai_sessions s where s.id = ai_agent_runs.session_id and s.user_id = auth.uid())
);

drop policy if exists "user accesses tool calls via run" on public.ai_agent_tool_calls;
create policy "user accesses tool calls via run" on public.ai_agent_tool_calls for select using (
  exists (
    select 1 from public.ai_agent_runs r
    join public.trade_ai_sessions s on s.id = r.session_id
    where r.id = ai_agent_tool_calls.run_id and s.user_id = auth.uid()
  )
);

drop policy if exists "anyone can view enabled skills" on public.ai_skill_registry;
create policy "anyone can view enabled skills" on public.ai_skill_registry for select using (enabled = true);

drop policy if exists "anyone can view enabled agents" on public.ai_agent_definitions;
create policy "anyone can view enabled agents" on public.ai_agent_definitions for select using (enabled = true);
