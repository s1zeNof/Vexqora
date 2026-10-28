-- Every canonical signal must be monitored even when nobody executes it.
-- This trigger is deliberately database-side so web, worker and future API
-- ingestion paths cannot accidentally skip the learning loop.

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

