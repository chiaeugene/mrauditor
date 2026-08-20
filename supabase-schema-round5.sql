-- ─────────────────────────────────────────────────────────────────────────────
-- Round 5 — let firm-level events reach the activity trail.
--
-- Creating a login, resetting a password, selling or suspending a firm: none of
-- these belong to an engagement, and activity_log.engagement_id was NOT NULL,
-- so every one of those inserts was rejected with a 400. The client caught the
-- error and carried on, which is why nothing looked broken — but it meant a
-- firm had NO record of who created whose login. That is precisely the trail an
-- ISQM 1 review asks a practice for.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table activity_log alter column engagement_id drop not null;

-- Firm-level rows are scoped by firm instead of by engagement.
alter table activity_log add column if not exists firm_id uuid references firms(id) on delete cascade;
create index if not exists idx_activity_firm on activity_log(firm_id) where firm_id is not null;

-- A firm event is written by one of its own members, about their own firm.
drop policy if exists "firm activity insert" on activity_log;
create policy "firm activity insert" on activity_log for insert
  with check (engagement_id is null and auth.uid() = owner and firm_id = my_firm_id());

-- Everyone in the firm can read them: an administrator's actions are exactly
-- what the rest of the firm may need to see.
drop policy if exists "firm activity read" on activity_log;
create policy "firm activity read" on activity_log for select
  using (engagement_id is null and firm_id is not null and firm_id = my_firm_id());
