-- ============================================================
-- Mr Auditor — Schema round 2 (run once, after supabase-schema.sql)
-- Adds: immutable activity trail, evidence tick-marks, query/PBC log.
-- ============================================================

-- Activity log — append-only. No update/delete policy is granted at all,
-- so once a row is written, even the owner cannot alter or erase it via
-- the API. This is what makes it a genuine audit trail, not just a list.
create table if not exists activity_log (
  id          uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references engagements(id) on delete cascade,
  owner       uuid not null references auth.users(id) on delete cascade,
  actor       text not null,             -- who did it (best-effort display name/email)
  action      text not null,             -- short verb phrase, e.g. "Posted adjustment"
  detail      text,                      -- longer description
  created_at  timestamptz not null default now()
);
alter table activity_log enable row level security;
create policy "own activity read" on activity_log for select using (auth.uid() = owner);
create policy "own activity insert" on activity_log for insert with check (auth.uid() = owner);
-- deliberately no update/delete policy

-- Evidence tick-marks — the auditor's "sighted, agreed to GL, initialled" mark
-- against a specific vault document, optionally scoped to a working paper.
create table if not exists evidence_ticks (
  id                uuid primary key default gen_random_uuid(),
  evidence_file_id  uuid not null references evidence_files(id) on delete cascade,
  engagement_id     uuid not null references engagements(id) on delete cascade,
  owner             uuid not null references auth.users(id) on delete cascade,
  wp_ref            text,                        -- e.g. 'F', 'C' — which lead schedule
  status            text not null default 'agreed', -- agreed | exception | query
  initials          text,
  tick_date         date,
  note              text,
  created_at        timestamptz not null default now()
);
alter table evidence_ticks enable row level security;
create policy "own ticks" on evidence_ticks for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- Queries & PBC (prepared-by-client) requests — one table, distinguished by `kind`.
create table if not exists queries (
  id             uuid primary key default gen_random_uuid(),
  engagement_id  uuid not null references engagements(id) on delete cascade,
  owner          uuid not null references auth.users(id) on delete cascade,
  kind           text not null default 'query',  -- 'pbc' | 'query'
  ref            text,                            -- e.g. 'Q1', 'PBC-3'
  category       text,                            -- maps to a vault category, where relevant
  wp_ref         text,                             -- e.g. 'F' — which lead schedule raised it
  question       text not null,
  status         text not null default 'open',    -- open | answered | closed
  response       text,
  raised_at      timestamptz not null default now(),
  responded_at   timestamptz,
  closed_at      timestamptz
);
alter table queries enable row level security;
create policy "own queries" on queries for all using (auth.uid() = owner) with check (auth.uid() = owner);

create index if not exists idx_activity_engagement on activity_log(engagement_id, created_at desc);
create index if not exists idx_ticks_evidence on evidence_ticks(evidence_file_id);
create index if not exists idx_ticks_engagement on evidence_ticks(engagement_id);
create index if not exists idx_queries_engagement on queries(engagement_id, status);
