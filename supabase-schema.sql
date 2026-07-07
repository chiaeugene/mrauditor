-- ============================================================
-- Mr Auditor — Supabase schema (run in the SQL editor)
-- Mirrors the client-side model: DB.clients[] (localStorage)
-- + evidence files (IndexedDB) → Postgres + Storage.
-- The app's per-engagement JSON export maps 1:1 onto
-- engagements.data, so migration is: export → insert.
-- ============================================================

create table if not exists engagements (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users(id) on delete cascade,
  name        text not null default '',           -- company name (denormalised for lists)
  fye         date,                                -- financial year end (denormalised)
  data        jsonb not null default '{}'::jsonb,  -- full engagement state (setup, tb, adjustments,
                                                   -- findingStatus, audit, tax, sign, notes, intake,
                                                   -- caAssets, bankin — the app's export format)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists evidence_files (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references engagements(id) on delete cascade,
  owner         uuid not null references auth.users(id) on delete cascade,
  category      text not null,                     -- one of the 11 vault categories
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint,
  storage_path  text not null,                     -- path inside the 'evidence' bucket
  uploaded_at   timestamptz not null default now()
);

create index if not exists idx_engagements_owner on engagements(owner);
create index if not exists idx_evidence_engagement on evidence_files(engagement_id);

-- Row-level security: each auditor sees only their own files
alter table engagements enable row level security;
alter table evidence_files enable row level security;

create policy "own engagements" on engagements
  for all using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "own evidence" on evidence_files
  for all using (auth.uid() = owner) with check (auth.uid() = owner);

-- Private storage bucket for evidence (create via dashboard or:)
insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false)
  on conflict (id) do nothing;

create policy "own evidence objects read" on storage.objects
  for select using (bucket_id = 'evidence' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own evidence objects write" on storage.objects
  for insert with check (bucket_id = 'evidence' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "own evidence objects delete" on storage.objects
  for delete using (bucket_id = 'evidence' and auth.uid()::text = (storage.foldername(name))[1]);

-- updated_at maintenance
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists trg_engagements_touch on engagements;
create trigger trg_engagements_touch before update on engagements
  for each row execute function touch_updated_at();
