-- Every canonical signal must be monitored even when nobody executes it.
-- This trigger is deliberately database-side so web, worker and future API
-- ingestion paths cannot accidentally skip the learning loop.

-- Keep this migration self-contained for production databases that were
-- provisioned before the canonical-signals migration was introduced.
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

create index if not exists signal_outcomes_monitoring_idx
  on public.signal_outcomes(status, last_evaluated_at)
  where status in ('monitoring', 'tp1_hit', 'tp2_hit');

alter table public.signal_outcomes enable row level security;
alter table public.signal_learning_events enable row level security;

drop policy if exists "signal outcomes through account" on public.signal_outcomes;
create policy "signal outcomes through account" on public.signal_outcomes
  for select using (public.owns_account(account_id));

drop policy if exists "signal outcomes insert through account" on public.signal_outcomes;
create policy "signal outcomes insert through account" on public.signal_outcomes
  for insert with check (public.owns_account(account_id));

drop policy if exists "signal outcomes update through account" on public.signal_outcomes;
create policy "signal outcomes update through account" on public.signal_outcomes
  for update using (public.owns_account(account_id)) with check (public.owns_account(account_id));

drop policy if exists "learning events through signal" on public.signal_learning_events;
create policy "learning events through signal" on public.signal_learning_events
  for select using (
    exists (
      select 1 from public.signals s
      where s.id = signal_id and public.owns_account(s.account_id)
    )
  );

create or replace function public.ensure_signal_outcome_tracking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_signal jsonb := case
    when jsonb_typeof(new.parsed -> 'signal') = 'object' then new.parsed -> 'signal'
    else new.parsed
  end;
  v_entry numeric;
  v_stop numeric;
  v_tp1 numeric;
  v_tp2 numeric;
  v_tp3 numeric;
begin
  v_entry := nullif(new.parsed ->> 'entryPrice', '')::numeric;
  v_stop := nullif(v_signal ->> 'stopLoss', '')::numeric;
  v_tp1 := nullif(v_signal #>> '{takeProfits,0,price}', '')::numeric;
  v_tp2 := nullif(v_signal #>> '{takeProfits,1,price}', '')::numeric;
  v_tp3 := nullif(v_signal #>> '{takeProfits,2,price}', '')::numeric;

  if v_entry is null or v_stop is null or v_tp1 is null
     or coalesce(v_signal ->> 'side', '') not in ('long', 'short')
     or coalesce(v_signal ->> 'symbol', '') = '' then
    return new;
  end if;

  insert into public.signal_outcomes (
    signal_id, account_id, symbol, side, entry_price, stop_loss,
    tp1, tp2, tp3, strategy, features, expires_at
  ) values (
    new.id,
    new.account_id,
    v_signal ->> 'symbol',
    v_signal ->> 'side',
    v_entry,
    v_stop,
    v_tp1,
    v_tp2,
    v_tp3,
    new.parsed #>> '{opportunity,strategy}',
    jsonb_build_object(
      'executionEvidence', coalesce(new.parsed -> 'executionEvidence', new.parsed #> '{opportunity,executionEvidence}'),
      'opportunity', new.parsed -> 'opportunity'
    ),
    coalesce(new.expires_at, now() + interval '48 hours')
  )
  on conflict (signal_id) do update set
    entry_price = excluded.entry_price,
    stop_loss = excluded.stop_loss,
    tp1 = excluded.tp1,
    tp2 = excluded.tp2,
    tp3 = excluded.tp3,
    strategy = coalesce(excluded.strategy, public.signal_outcomes.strategy),
    features = excluded.features,
    expires_at = excluded.expires_at;

  return new;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    -- Invalid signals remain rejected by application validation; do not make
    -- ordinary signal persistence fail because legacy JSON was malformed.
    return new;
end;
$$;

drop trigger if exists signals_ensure_outcome_tracking on public.signals;
create trigger signals_ensure_outcome_tracking
after insert or update of parsed, expires_at on public.signals
for each row execute function public.ensure_signal_outcome_tracking();

-- Backfill all existing canonical previews that have executable numeric levels.
insert into public.signal_outcomes (
  signal_id, account_id, symbol, side, entry_price, stop_loss,
  tp1, tp2, tp3, strategy, features, expires_at
)
select
  s.id,
  s.account_id,
  coalesce(s.parsed #>> '{signal,symbol}', s.parsed ->> 'symbol'),
  coalesce(s.parsed #>> '{signal,side}', s.parsed ->> 'side'),
  (s.parsed ->> 'entryPrice')::numeric,
  coalesce(s.parsed #>> '{signal,stopLoss}', s.parsed ->> 'stopLoss')::numeric,
  coalesce(s.parsed #>> '{signal,takeProfits,0,price}', s.parsed #>> '{takeProfits,0,price}')::numeric,
  nullif(coalesce(s.parsed #>> '{signal,takeProfits,1,price}', s.parsed #>> '{takeProfits,1,price}'), '')::numeric,
  nullif(coalesce(s.parsed #>> '{signal,takeProfits,2,price}', s.parsed #>> '{takeProfits,2,price}'), '')::numeric,
  s.parsed #>> '{opportunity,strategy}',
  jsonb_build_object(
    'executionEvidence', coalesce(s.parsed -> 'executionEvidence', s.parsed #> '{opportunity,executionEvidence}'),
    'opportunity', s.parsed -> 'opportunity'
  ),
  coalesce(s.expires_at, s.created_at + interval '48 hours')
from public.signals s
where s.parsed ? 'entryPrice'
  and coalesce(s.parsed #>> '{signal,side}', s.parsed ->> 'side') in ('long', 'short')
  and coalesce(s.parsed #>> '{signal,symbol}', s.parsed ->> 'symbol') is not null
  and coalesce(s.parsed #>> '{signal,stopLoss}', s.parsed ->> 'stopLoss') is not null
  and coalesce(s.parsed #>> '{signal,takeProfits,0,price}', s.parsed #>> '{takeProfits,0,price}') is not null
on conflict (signal_id) do nothing;

