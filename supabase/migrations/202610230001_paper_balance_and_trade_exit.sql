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

  if current_qty is distinct from expected_qty
     or current_realized_pnl is distinct from coalesce(expected_realized_pnl, 0) then
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
