-- ─────────────────────────────────────────────────────────────────────────────
-- Round 8 — the person comes first: User → Firm → Companies.
--
-- Until now a firm and its first login were born in one action, so the tenant
-- existed before the person did. The platform now creates a LOGIN; that person
-- sets up their own firm on first sign-in; the firm keeps its own companies.
--
-- Two consequences handled here:
--
--  1. A login may exist with no firm yet. That was previously a broken state
--     (a user who could sign in and see nothing). It becomes a legitimate,
--     temporary one, and the price the platform agreed has to survive until
--     the firm exists to carry it.
--
--  2. "The platform can see which companies a firm has, but not their audit
--     files." That has to be true in the database, not merely in the screen —
--     so the blanket super_admin grant over every engagement comes OUT, and a
--     narrow directory view goes in that carries names and dates and nothing
--     else.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) The agreed price, parked on the login until the firm exists to hold it.
alter table app_users
  add column if not exists pending_monthly_price numeric(10,2);

comment on column app_users.pending_monthly_price is
  'Price the platform agreed before this person set up their firm. Moved onto firms.monthly_price at setup, then left as a record of what was quoted.';

-- 2) The platform loses read access to other firms'' engagement DATA.
--    A firm member still reaches their own firm''s files; an engagement owner
--    and an invited member still reach theirs. What goes is the line that let
--    the platform open any customer''s audit file.
create or replace function can_access_engagement(eid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select
       exists(select 1 from engagements e where e.id = eid and e.owner = auth.uid())
    or exists(select 1 from engagement_members m
              where m.engagement_id = eid
                and lower(m.member_email) = lower(coalesce(auth.jwt()->>'email','')))
    or exists(select 1 from engagements e
              where e.id = eid and e.firm_id is not null and e.firm_id = my_firm_id())
$$;

-- 3) …and gains a directory instead: which companies a firm has, and when they
--    were last touched. No trial balance, no evidence, no working papers.
create or replace view engagement_directory
with (security_invoker = true) as
  select e.id, e.firm_id, e.name, e.fye, e.created_at, e.updated_at
  from engagements e
  where e.firm_id is not null;

-- The view is security_invoker, so it is governed by a policy on a table the
-- platform CAN read. Expose it through a definer function instead, which is
-- the only place the platform-wide grant now lives.
drop view if exists engagement_directory;

create or replace function firm_directory()
returns table (firm_id uuid, firm_name text, af_no text, active boolean,
               monthly_price numeric, logins bigint,
               engagement_id uuid, engagement_name text, fye date, updated_at timestamptz)
language sql security definer stable set search_path = public as $$
  select f.id, f.name, f.af_no, f.active, f.monthly_price,
         (select count(*) from app_users u where u.firm_id = f.id),
         e.id, e.name, e.fye, e.updated_at
  from firms f
  -- Every firm starts with one empty engagement shell; it is not a client
  -- company until somebody names it, and it should not be counted as one.
  left join engagements e on e.firm_id = f.id
       and coalesce(nullif(btrim(e.name), ''), null) is not null
  where my_role() = 'super_admin'
     or (my_role() = 'agent' and f.agent_id = auth.uid())
  order by f.created_at, e.created_at
$$;

revoke all on function firm_directory() from public;
grant execute on function firm_directory() to authenticated;

comment on function firm_directory() is
  'Platform/agent view of the estate: firms, how many logins, and the NAMES and year ends of their companies. Deliberately carries no engagement data — the platform can see that a firm has a client called X with a December year end, and nothing about the audit itself.';
