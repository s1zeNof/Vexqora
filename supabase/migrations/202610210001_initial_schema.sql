create extension if not exists pgcrypto;

create type public.exchange_kind as enum ('bybit', 'binance');
create type public.exchange_environment as enum ('live', 'demo');
create type public.signal_source as enum ('chat', 'telegram', 'tradingview', 'api');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.exchange_accounts (
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

create unique index one_active_exchange_account_per_user
  on public.exchange_accounts(user_id) where is_active;

create table public.risk_settings (
  account_id uuid primary key references public.exchange_accounts(id) on delete cascade,
  risk_per_trade_pct numeric(7,4) not null default 1 check (risk_per_trade_pct > 0 and risk_per_trade_pct <= 100),
  max_leverage numeric(7,2) not null default 5 check (max_leverage >= 1),
  max_open_positions integer not null default 3 check (max_open_positions > 0),
  max_daily_loss_pct numeric(7,4) not null default 5 check (max_daily_loss_pct > 0 and max_daily_loss_pct <= 100),
  allowed_symbols text[],
  kill_switch boolean not null default false,
  auto_confirm_telegram boolean not null default false
);

create table public.signals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.exchange_accounts(id) on delete cascade,
  raw_text text,
  parsed jsonb,
  source public.signal_source not null,
  status text not null,
  reject_reason text,
  created_at timestamptz not null default now()
);

create table public.trades (
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
  trailing jsonb,
  realized_pnl numeric,
  opened_at timestamptz,
  closed_at timestamptz
);

create table public.trade_targets (
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

create table public.orders (
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

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.exchange_accounts(id) on delete cascade,
  role text not null,
  kind text not null,
  content text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  config_enc text,
  chat_id text,
  is_active boolean not null default true
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.exchange_accounts(id) on delete set null,
  action text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

create table public.execution_jobs (
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

create index chat_messages_account_created_idx on public.chat_messages(account_id, created_at desc);
create index trades_account_created_idx on public.trades(account_id, opened_at desc);
create index signals_account_created_idx on public.signals(account_id, created_at desc);

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

create policy "profiles own rows" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "accounts own rows" on public.exchange_accounts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "risk settings through account" on public.risk_settings for all using (public.owns_account(account_id)) with check (public.owns_account(account_id));
create policy "signals through account" on public.signals for all using (public.owns_account(account_id)) with check (public.owns_account(account_id));
create policy "trades through account" on public.trades for all using (public.owns_account(account_id)) with check (public.owns_account(account_id));
create policy "targets through trade" on public.trade_targets for all using (exists(select 1 from public.trades t where t.id = trade_id and public.owns_account(t.account_id))) with check (exists(select 1 from public.trades t where t.id = trade_id and public.owns_account(t.account_id)));
create policy "orders through trade" on public.orders for all using (exists(select 1 from public.trades t where t.id = trade_id and public.owns_account(t.account_id))) with check (exists(select 1 from public.trades t where t.id = trade_id and public.owns_account(t.account_id)));
create policy "messages through account" on public.chat_messages for all using (public.owns_account(account_id)) with check (public.owns_account(account_id));
create policy "integrations own rows" on public.integrations for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "audit own rows" on public.audit_log for select using (user_id = auth.uid());
create policy "audit insert own rows" on public.audit_log for insert with check (user_id = auth.uid() and (account_id is null or public.owns_account(account_id)));
create policy "execution jobs through account" on public.execution_jobs for select using (public.owns_account(account_id));
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

alter publication supabase_realtime add table public.chat_messages;

