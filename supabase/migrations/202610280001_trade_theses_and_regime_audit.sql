-- Migration: 202610280001_trade_theses_and_regime_audit.sql
-- Implements P0-08: Persistent Trade Theses with Full Revision History and Invalidation Audit Trail

create table if not exists public.trade_theses (
  id uuid primary key default gen_random_uuid(),
  thesis_key text not null,
  trade_id uuid references public.trades(id) on delete cascade,
  account_id uuid references public.exchange_accounts(id) on delete cascade,
  symbol text not null,
  side text not null default 'neutral',
  status text not null default 'VALID' check (status in ('VALID', 'WEAKENED', 'INVALIDATED')),
  revision integer not null default 1,
  entry_price numeric,
  invalidation_price numeric,
  primary_rationale text,
  invalidation_trigger text,
  supporting_evidence jsonb default '[]'::jsonb,
  opposing_evidence jsonb default '[]'::jsonb,
  diff_from_previous jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trade_theses_key_revision_idx
  on public.trade_theses(thesis_key, revision desc);

create index if not exists trade_theses_symbol_status_idx
  on public.trade_theses(symbol, status);

alter table public.trade_theses enable row level security;

create policy "Users can view trade theses for their accounts"
  on public.trade_theses for select
  using (
    account_id in (
      select id from public.exchange_accounts where user_id = auth.uid()
    ) or auth.role() = 'service_role'
  );

create policy "Service role and account owners can insert trade theses"
  on public.trade_theses for insert
  with check (
    account_id in (
      select id from public.exchange_accounts where user_id = auth.uid()
    ) or auth.role() = 'service_role'
  );
