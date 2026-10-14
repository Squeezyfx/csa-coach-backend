-- Trading accounts registered for the bonus MT4/MT5 indicator.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
--
-- Subscribers add and remove accounts through the page; the server (service role)
-- does the writing and enforces the limits (Pro 1, Elite 3). Signed-in users can
-- only read their own rows. You read and update everything in Table Editor >
-- indicator_access, which ignores these rules.

create table if not exists public.indicator_access (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  account_number text not null check (account_number ~ '^[0-9]{4,12}$'),
  platform       text not null check (platform in ('mt4', 'mt5')),
  broker         text,
  status         text not null default 'pending' check (status in ('pending', 'active')),
  activated_at   timestamptz,
  note           text,
  unique (user_id, account_number)
);

create index if not exists indicator_access_user_idx on public.indicator_access (user_id);
create index if not exists indicator_access_account_idx on public.indicator_access (account_number);

alter table public.indicator_access enable row level security;

drop policy if exists "users read their own indicator accounts" on public.indicator_access;
create policy "users read their own indicator accounts"
  on public.indicator_access
  for select
  to authenticated
  using (auth.uid() = user_id);

-- ===========================================================================
-- Each time you rebuild the indicator, run these in the SQL editor (not part of
-- the setup above).
-- ===========================================================================

-- 1) Who is waiting for access, and anyone sharing an account number.
-- select a.created_at, p.email, p.subscription_plan, a.platform, a.account_number, a.broker, a.status
-- from indicator_access a join profiles p on p.id = a.user_id
-- where a.status = 'pending' order by a.created_at;
--
-- select account_number, count(distinct user_id) as users
-- from indicator_access group by account_number having count(distinct user_id) > 1;

-- 2) The two lines to paste into the MQ4 file (replace ACCOUNT[] and EXPIRY[]).
--    Only accounts of subscribers who are paid up, or inside the 7-day payment
--    grace window. The expiry is the end of their paid period plus 2 days, so a
--    late renewal never locks someone out.
-- with live as (
--   select a.account_number::bigint as acct,
--          (p.current_period_end + interval '2 days')::date as expires
--   from indicator_access a join profiles p on p.id = a.user_id
--   where p.subscription_plan in ('pro', 'elite')
--     and ( p.subscription_status in ('active', 'trialing')
--        or (p.subscription_status = 'past_due' and p.current_period_start + interval '7 days' > now()) )
--     and p.current_period_end is not null
-- )
-- select 'int ACCOUNT[100]={' || string_agg(acct::text, ',' order by acct) || '};' as account_line,
--        'datetime EXPIRY[100]={' || string_agg('D''' || to_char(expires, 'DD.MM.YYYY') || '''', ',' order by acct) || '};' as expiry_line
-- from live;

-- 3) After you send someone the compiled indicator, mark their accounts active:
-- update indicator_access set status = 'active', activated_at = now()
-- where account_number in ('123456', '234567');
