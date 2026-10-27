-- Migration: 202610270002_trade_ai_security_and_dedup.sql
-- Enforces cross-user isolation, idempotent session creation, and persistent message deduplication via event_id.

-- 1. Idempotent session index for trades: exactly 1 active AI session per trade
create unique index if not exists trade_ai_sessions_trade_idx
  on public.trade_ai_sessions(trade_id)
  where trade_id is not null;

-- 2. Idempotent session index for signals without trade: exactly 1 session per user per signal
create unique index if not exists trade_ai_sessions_user_signal_idx
  on public.trade_ai_sessions(user_id, signal_id)
  where signal_id is not null and trade_id is null;

-- 3. Persistent message deduplication: prevents duplicate events across worker restarts
create unique index if not exists trade_ai_messages_session_event_idx
  on public.trade_ai_messages(session_id, event_id)
  where event_id is not null;

-- 4. Strengthen Row Level Security for trade_ai_sessions
-- Prevent User A from referencing an account_id, trade_id, or signal_id belonging to User B.
drop policy if exists "user owns trade_ai_sessions" on public.trade_ai_sessions;

create policy "user owns trade_ai_sessions" on public.trade_ai_sessions
  for all
  using (
    user_id = auth.uid()
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.exchange_accounts a
      where a.id = trade_ai_sessions.account_id
        and a.user_id = auth.uid()
    )
    and (
      trade_id is null or exists (
        select 1 from public.trades t
        join public.exchange_accounts a on a.id = t.account_id
        where t.id = trade_ai_sessions.trade_id
          and a.user_id = auth.uid()
      )
    )
    and (
      signal_id is null or exists (
        select 1 from public.signals s
        join public.exchange_accounts a on a.id = s.account_id
        where s.id = trade_ai_sessions.signal_id
          and a.user_id = auth.uid()
      )
    )
  );

-- 5. Strengthen message creation policy: ensure session ownership on insert
drop policy if exists "user accesses messages via session" on public.trade_ai_messages;

create policy "user accesses messages via session" on public.trade_ai_messages
  for select
  using (
    exists (
      select 1 from public.trade_ai_sessions s
      where s.id = trade_ai_messages.session_id
        and s.user_id = auth.uid()
    )
  );

create policy "user inserts messages into own session" on public.trade_ai_messages
  for insert
  with check (
    exists (
      select 1 from public.trade_ai_sessions s
      where s.id = trade_ai_messages.session_id
        and s.user_id = auth.uid()
    )
  );
