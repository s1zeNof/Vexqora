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
