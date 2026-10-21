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

