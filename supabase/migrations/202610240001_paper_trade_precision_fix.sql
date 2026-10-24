-- Fix float precision discrepancy in optimistic locking for paper trade settlement
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

  -- Use epsilon tolerance for float-to-numeric comparisons from JavaScript
  if abs(coalesce(current_qty, 0) - coalesce(expected_qty, 0)) > 0.0001
     or abs(coalesce(current_realized_pnl, 0) - coalesce(expected_realized_pnl, 0)) > 0.0001 then
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
