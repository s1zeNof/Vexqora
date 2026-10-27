-- =============================================================================
-- VEXQORA TRADE - SAFE INCREMENTAL AI TABLES MIGRATION
-- Safe: Transactional, idempotent, sets up ONLY the 7 Trade AI Companion tables
-- and their associated RLS policies without touching balances or existing orders.
-- =============================================================================

begin;

-- 1. Ensure security helper function exists
create or replace function public.owns_account(target_account_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.exchange_accounts where id = target_account_id and user_id = auth.uid()) $$;

-- 2. Verify or safely create referenced tables if running on partially migrated database
create table if not exists public.exchange_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exchange text not null default 'paper',
  environment text not null default 'demo',
  label text not null default 'Main Account',
  api_key_enc text,
  api_secret_enc text,
  is_active boolean not null default false,
  paper_balance numeric(20,8) default 1000,
  created_at timestamptz not null default now()
);

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.exchange_accounts(id) on delete cascade,
  raw_text text,
  parsed jsonb,
  source text not null default 'chat',
  status text not null default 'active',
  reject_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.exchange_accounts(id) on delete cascade,
  signal_id uuid references public.signals(id) on delete set null,
  symbol text not null,
  side text not null check (side in ('long', 'short')),
  status text not null default 'active',
  entry_avg numeric,
  qty numeric,
  leverage numeric,
  sl numeric,
  trailing_stop jsonb,
  realized_pnl numeric,
  exit_reason text,
  exit_price numeric,
  exit_details jsonb,
  opened_at timestamptz default now(),
  closed_at timestamptz
);

-- Ensure critical columns exist if tables were created previously
alter table public.signals add column if not exists account_id uuid references public.exchange_accounts(id) on delete cascade;
alter table public.trades add column if not exists account_id uuid references public.exchange_accounts(id) on delete cascade;
alter table public.trades add column if not exists signal_id uuid references public.signals(id) on delete set null;

-- 3. Trade AI Sessions
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

alter table public.trade_ai_sessions enable row level security;

create index if not exists trade_ai_sessions_account_trade_idx
  on public.trade_ai_sessions(account_id, trade_id);

create index if not exists trade_ai_sessions_user_idx
  on public.trade_ai_sessions(user_id, status);

-- 4. Trade AI Messages
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

alter table public.trade_ai_messages enable row level security;

create index if not exists trade_ai_messages_session_time_idx
  on public.trade_ai_messages(session_id, created_at asc);

-- 5. Trade AI Decisions
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

alter table public.trade_ai_decisions enable row level security;

create index if not exists trade_ai_decisions_session_idx
  on public.trade_ai_decisions(session_id, created_at desc);

-- 6. AI Agent Definitions
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

alter table public.ai_agent_definitions enable row level security;

-- 7. AI Skill Registry
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

alter table public.ai_skill_registry enable row level security;

-- 8. AI Agent Runs
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

alter table public.ai_agent_runs enable row level security;

-- 9. AI Agent Tool Calls
create table if not exists public.ai_agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_agent_runs(id) on delete cascade,
  skill_key text not null references public.ai_skill_registry(skill_key) on delete cascade,
  input_payload jsonb,
  output_summary text,
  error_info text,
  created_at timestamptz not null default now()
);

alter table public.ai_agent_tool_calls enable row level security;

-- 10. Seed Agent Definitions
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

-- 11. Seed Core Skills
insert into public.ai_skill_registry (skill_key, version, display_name, description, enabled)
values
  ('market.mtf_structure', '1.0.0', 'Multi-Timeframe Structure', 'Evaluates trend, swing highs/lows, BOS and CHOCH across 1D/4H/1H/15M/5M.', true),
  ('orderflow.cvd_obi', '1.0.0', 'Order Flow & CVD Analyzer', 'Evaluates Cumulative Volume Delta, Tape Aggression, and Order Book Imbalance.', true),
  ('derivatives.squeeze_oi', '1.0.0', 'Derivatives & Squeeze Detector', 'Analyzes Open Interest changes and funding rate skew for liquidation risk.', true),
  ('news.impact_scanner', '1.0.0', 'News & Macro Event Scanner', 'Checks verified exchange announcements, delistings, and high-impact macro data.', true),
  ('risk.capital_guardian', '1.0.0', 'Capital Guardian Risk Policy', 'Enforces strict max daily loss, portfolio exposure, and protective SL/TP.', true)
on conflict (skill_key) do nothing;

-- 12. RLS Policies
drop policy if exists "user owns trade_ai_sessions" on public.trade_ai_sessions;
create policy "user owns trade_ai_sessions" on public.trade_ai_sessions
  for all using (user_id = auth.uid());

drop policy if exists "user accesses messages via session" on public.trade_ai_messages;
create policy "user accesses messages via session" on public.trade_ai_messages
  for all using (
    exists (
      select 1 from public.trade_ai_sessions s
      where s.id = trade_ai_messages.session_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "user accesses decisions via session" on public.trade_ai_decisions;
create policy "user accesses decisions via session" on public.trade_ai_decisions
  for all using (
    exists (
      select 1 from public.trade_ai_sessions s
      where s.id = trade_ai_decisions.session_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "user accesses runs via session" on public.ai_agent_runs;
create policy "user accesses runs via session" on public.ai_agent_runs
  for select using (
    exists (
      select 1 from public.trade_ai_sessions s
      where s.id = ai_agent_runs.session_id
        and s.user_id = auth.uid()
    )
  );

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

drop policy if exists "anyone can view enabled skills" on public.ai_skill_registry;
create policy "anyone can view enabled skills" on public.ai_skill_registry
  for select using (enabled = true);

drop policy if exists "anyone can view enabled agents" on public.ai_agent_definitions;
create policy "anyone can view enabled agents" on public.ai_agent_definitions
  for select using (enabled = true);

-- Realtime subscription for trade messages
do $$ begin
  alter publication supabase_realtime add table public.trade_ai_messages;
exception when others then null;
end $$;

commit;
