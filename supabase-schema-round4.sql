-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 004 — FIRM ACCOUNTS, ADMIN-CREATED LOGINS, AGENCY LAYER
--
-- Modelled on Elaine/Lily's migration 012. Turns Mr Auditor from "one login,
-- one person's engagements" into a product a firm buys and an agent resells:
--
--   super_admin → the platform (us). Sees every firm.
--   agent       → a reseller. firm_id NULL; sees ONLY the firms they recruited.
--   admin       → runs one audit firm: creates and disables its logins.
--   partner     → signs and finalises. manager → reviews. staff → prepares.
--
-- The password itself always lives in Supabase Auth (auth.users). This table
-- is the PROFILE: which firm, what role, still active. Logins are created by
-- an admin through the admin-users edge function — there is no self-signup.
--
-- BACKWARD COMPATIBLE BY DESIGN. Every existing engagement keeps working
-- through its owner: a user with no profile row behaves exactly as before,
-- and firm scoping only ever ADDS access. Nothing is dropped.
--
-- Run once in the Supabase SQL editor, after rounds 1-3.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) Firms — the tenant, and what it pays ──────────────────────────────────
create table if not exists firms (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  af_no                  text,                       -- MIA firm number, e.g. AF 002345
  active                 boolean not null default true,
  monthly_price          numeric not null default 0,
  subscription_started_on date,
  agent_id               uuid,                       -- who recruited this firm (FK added below)
  created_at             timestamptz not null default now()
);

-- ── 2) Profiles on top of Supabase Auth ──────────────────────────────────────
create table if not exists app_users (
  id                   uuid primary key references auth.users(id) on delete cascade,
  firm_id              uuid references firms(id) on delete set null,  -- NULL for super_admin/agent
  email                text not null,
  name                 text not null default '',
  role                 text not null default 'staff'
                       check (role in ('super_admin','agent','admin','partner','manager','staff')),
  active               boolean not null default true,
  must_change_password boolean not null default true,
  parent_id            uuid references app_users(id) on delete set null,  -- an agent's master
  created_at           timestamptz not null default now()
);
create index if not exists idx_app_users_firm on app_users(firm_id);
create index if not exists idx_app_users_email on app_users(lower(email));
create index if not exists idx_app_users_parent on app_users(parent_id);

alter table firms drop constraint if exists firms_agent_fkey;
alter table firms add constraint firms_agent_fkey
  foreign key (agent_id) references app_users(id) on delete set null;
create index if not exists idx_firms_agent on firms(agent_id);

-- ── 3) Engagements belong to a firm ──────────────────────────────────────────
-- Nullable on purpose: engagements created before this migration have no firm
-- and stay reachable through their owner, exactly as they are today.
alter table engagements add column if not exists firm_id uuid references firms(id) on delete set null;
create index if not exists idx_engagements_firm on engagements(firm_id);

-- ── 4) Identity helpers ──────────────────────────────────────────────────────
-- SECURITY DEFINER so policies can read app_users without recursing through
-- app_users' own RLS (the same trap round 3 hit with engagement_members).
create or replace function my_firm_id() returns uuid
language sql security definer stable set search_path = public as $$
  select firm_id from app_users where id = auth.uid() and active
$$;
create or replace function my_role() returns text
language sql security definer stable set search_path = public as $$
  select role from app_users where id = auth.uid() and active
$$;
grant execute on function my_firm_id() to authenticated;
grant execute on function my_role() to authenticated;

-- ── 5) Engagement access now includes the firm ───────────────────────────────
-- REPLACES the round-3 function, keeping owner + invited-member access and
-- adding: anyone in the same firm, and the platform. Access only widens.
create or replace function can_access_engagement(eid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select
       exists(select 1 from engagements e where e.id = eid and e.owner = auth.uid())
    or exists(select 1 from engagement_members m
              where m.engagement_id = eid
                and lower(m.member_email) = lower(coalesce(auth.jwt()->>'email','')))
    or exists(select 1 from engagements e
              where e.id = eid and e.firm_id is not null and e.firm_id = my_firm_id())
    or my_role() = 'super_admin'
$$;

-- ── 6) RLS on the new tables ─────────────────────────────────────────────────
alter table firms enable row level security;
alter table app_users enable row level security;

-- Everyone reads their own firm; the platform reads all; an agent reads the
-- firms they recruited.
drop policy if exists "firm read" on firms;
create policy "firm read" on firms for select using (
  id = my_firm_id() or my_role() = 'super_admin'
  or (my_role() = 'agent' and agent_id = auth.uid())
);
-- Writes to firms go through the edge functions (service role), never the
-- browser: price and agent assignment are money, not settings.

drop policy if exists "profile read" on app_users;
create policy "profile read" on app_users for select using (
  id = auth.uid()
  or (firm_id is not null and firm_id = my_firm_id())
  or my_role() = 'super_admin'
  or (my_role() = 'agent' and firm_id in (select id from firms where agent_id = auth.uid()))
);
-- A user may clear their own must_change_password flag after setting a new
-- password, and nothing else. Role, firm and active are admin territory and
-- move only through the edge function.
drop policy if exists "profile self update" on app_users;
create policy "profile self update" on app_users for update
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on table app_users from authenticated;
grant update (must_change_password, name) on table app_users to authenticated;

-- ── 7) Per-firm module flags — DEFAULT ON ────────────────────────────────────
-- A firm with no row for a feature HAS it. A row with enabled=false switches
-- it off, so existing firms need no backfill and disabling is deliberate.
create table if not exists firm_features (
  firm_id uuid not null references firms(id) on delete cascade,
  feature text not null,
  enabled boolean not null default true,
  primary key (firm_id, feature)
);
alter table firm_features enable row level security;
drop policy if exists "features read" on firm_features;
create policy "features read" on firm_features for select using (
  firm_id = my_firm_id() or my_role() = 'super_admin'
);

-- ── 8) Commission ladder — more active firms, higher rate ────────────────────
create table if not exists commission_tiers (
  min_clients integer primary key,
  rate_pct    numeric not null
);
insert into commission_tiers (min_clients, rate_pct) values (0, 20), (5, 25), (10, 30)
on conflict (min_clients) do nothing;
alter table commission_tiers enable row level security;
drop policy if exists "tiers read" on commission_tiers;
create policy "tiers read" on commission_tiers for select using (auth.uid() is not null);

-- ── 9) Money in: what a firm pays us ─────────────────────────────────────────
-- rate_pct and commission are SNAPSHOTTED at the moment of payment, so moving
-- an agent up a tier later never silently rewrites what they already earned.
create table if not exists agency_payments (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null references firms(id) on delete cascade,
  amount      numeric not null,
  paid_on     date not null default current_date,
  note        text,
  agent_id    uuid references app_users(id) on delete set null,
  rate_pct    numeric not null default 0,
  commission  numeric not null default 0,
  recorded_by uuid references app_users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_agency_payments_firm  on agency_payments(firm_id);
create index if not exists idx_agency_payments_agent on agency_payments(agent_id);
alter table agency_payments enable row level security;
drop policy if exists "payments read" on agency_payments;
create policy "payments read" on agency_payments for select using (
  my_role() = 'super_admin' or (my_role() = 'agent' and agent_id = auth.uid())
);

-- ── 10) Money out: commission settled with an agent ──────────────────────────
create table if not exists agency_payouts (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references app_users(id) on delete cascade,
  amount     numeric not null,
  paid_on    date not null default current_date,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_agency_payouts_agent on agency_payouts(agent_id);
alter table agency_payouts enable row level security;
drop policy if exists "payouts read" on agency_payouts;
create policy "payouts read" on agency_payouts for select using (
  my_role() = 'super_admin' or agent_id = auth.uid()
);

-- ── 11) Let a firm's engagements carry the firm on creation ──────────────────
-- Round 3 revoked table-level UPDATE and granted back only (name, fye, data).
-- firm_id is deliberately NOT added to that grant: a member must not be able
-- to move an engagement into another firm. It is set on INSERT, or by the
-- service role.
grant update (name, fye, data) on table engagements to authenticated;
