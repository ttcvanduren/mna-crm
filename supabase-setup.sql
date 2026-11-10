-- M&A CRM: run this once in Supabase → SQL Editor → New query → Run.
-- Only people who log in with an @33equity.eu address can read or change data.

create table if not exists public.companies (
  id          text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.activity (
  id          text primary key,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);

-- Shared settings for the team: email templates, match weights, remembered column mappings.
create table if not exists public.app_state (
  key         text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.companies enable row level security;
alter table public.activity  enable row level security;
alter table public.app_state enable row level security;

create or replace function public.is_team_member() returns boolean
language sql stable as $$
  select coalesce(lower(auth.jwt() ->> 'email') like '%@33equity.eu', false)
$$;

drop policy if exists "team access" on public.companies;
drop policy if exists "team access" on public.activity;
drop policy if exists "team access" on public.app_state;
create policy "team access" on public.companies for all to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy "team access" on public.activity  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());
create policy "team access" on public.app_state for all to authenticated using (public.is_team_member()) with check (public.is_team_member());

-- Newer Supabase projects don't grant table access to logged-in users automatically. The policies above still
-- decide WHO gets in (only @33equity.eu); these grants just allow logged-in users to use the tables at all.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.companies, public.activity, public.app_state to authenticated;
