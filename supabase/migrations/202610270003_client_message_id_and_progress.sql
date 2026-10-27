-- 202610270003_client_message_id_and_progress.sql
-- Add client_message_id column and index to trade_ai_messages for optimistic UI deduplication

alter table public.trade_ai_messages
  add column if not exists client_message_id text;

create index if not exists trade_ai_messages_session_client_msg_idx
  on public.trade_ai_messages(session_id, client_message_id)
  where client_message_id is not null;
