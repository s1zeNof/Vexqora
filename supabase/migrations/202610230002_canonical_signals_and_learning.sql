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
create policy "signal outcomes through account" on public.signal_outcomes
  for select using (public.owns_account(account_id));

drop policy if exists "signal outcomes insert through account" on public.signal_outcomes;
create policy "signal outcomes insert through account" on public.signal_outcomes
  for insert with check (public.owns_account(account_id));

drop policy if exists "learning events through signal" on public.signal_learning_events;
create policy "learning events through signal" on public.signal_learning_events
  for select using (
    exists (
      select 1 from public.signals s
      where s.id = signal_id and public.owns_account(s.account_id)
    )
  );

drop policy if exists "signal outcomes update through account" on public.signal_outcomes;
create policy "signal outcomes update through account" on public.signal_outcomes
  for update using (public.owns_account(account_id)) with check (public.owns_account(account_id));
