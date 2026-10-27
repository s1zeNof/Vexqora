-- =============================================================================
-- VEXQORA TRADE - READ-ONLY DATABASE DIAGNOSTICS SCRIPT
-- Safe: Performs ONLY SELECT queries against information_schema and pg_catalog.
-- Run this in Supabase SQL Editor to inspect the exact existing schema state.
-- =============================================================================

-- 1. Check all existing public tables
select 
  table_name,
  (select count(*) from information_schema.columns c where c.table_schema = 'public' and c.table_name = t.table_name) as column_count
from information_schema.tables t
where table_schema = 'public'
order by table_name;

-- 2. Inspect column structure of core trading tables
select 
  table_name, 
  column_name, 
  data_type, 
  is_nullable
from information_schema.columns
where table_schema = 'public' 
  and table_name in (
    'profiles', 
    'exchange_accounts', 
    'risk_settings', 
    'signals', 
    'trades', 
    'orders', 
    'trade_targets',
    'signal_outcomes',
    'trade_ai_sessions',
    'trade_ai_messages'
  )
order by table_name, ordinal_position;

-- 3. Check existing RLS status
select 
  schemaname, 
  tablename, 
  rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
order by tablename;

-- 4. Check existing RLS policies
select 
  schemaname, 
  tablename, 
  policyname, 
  roles, 
  cmd as operation
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 5. Check if helper functions exist
select 
  routine_name, 
  routine_type, 
  data_type as return_type
from information_schema.routines
where routine_schema = 'public' 
  and routine_name in (
    'owns_account', 
    'claim_execution_job', 
    'ensure_user_workspace', 
    'adjust_paper_balance', 
    'apply_paper_trade_result'
  )
order by routine_name;
