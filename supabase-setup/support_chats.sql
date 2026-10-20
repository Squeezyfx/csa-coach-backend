-- Questions people ask the in-app help chat, and the answers given.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
--
-- The server writes these rows (service role) and counts them for the daily limit.
-- People cannot read or change them from the page. You read them in
-- Table Editor > support_chats to see what people struggle with and improve the help guide.

create table if not exists public.support_chats (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  email       text,
  question    text not null,
  answer      text,
  used_review boolean not null default false
);

create index if not exists support_chats_user_day_idx
  on public.support_chats (user_id, created_at desc);

alter table public.support_chats enable row level security;
-- No policies on purpose: only the server (service role) can read or write this table.
