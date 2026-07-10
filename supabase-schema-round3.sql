-- ============================================================
-- Mr Auditor — Schema round 3 (run once, after rounds 1 and 2)
-- Adds: multi-user engagement teams (F1).
-- An engagement owner invites colleagues BY EMAIL; when that person signs
-- in with the same email, row-level security opens the engagement, its
-- vault files, tick-marks, queries and activity trail to them. Roles
-- (staff / manager / partner) drive the in-app review-locking rules.
-- ============================================================

create table if not exists engagement_members (
  id             uuid primary key default gen_random_uuid(),
  engagement_id  uuid not null references engagements(id) on delete cascade,
  member_email   text not null,
  role           text not null default 'staff',   -- staff | manager | partner
  added_by       uuid not null references auth.users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (engagement_id, member_email)
);
alter table engagement_members enable row level security;

-- Single source of truth for "may this signed-in user touch engagement X?"
-- SECURITY DEFINER so it can read both tables without tripping RLS recursion.
create or replace function can_access_engagement(eid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from engagements e where e.id = eid and e.owner = auth.uid())
      or exists(select 1 from engagement_members m
                where m.engagement_id = eid
                  and lower(m.member_email) = lower(coalesce(auth.jwt()->>'email','')));
$$;
grant execute on function can_access_engagement(uuid) to authenticated;

-- Storage paths are '<uploaderId>/<engagementId>/<file>' — pull out the
-- engagement id safely (malformed paths simply return false, never error).
create or replace function can_access_evidence_path(p text) returns boolean
language plpgsql security definer stable set search_path = public, storage as $$
declare eid uuid;
begin
  begin
    eid := ((storage.foldername(p))[2])::uuid;
  exception when others then
    return false;
  end;
  return can_access_engagement(eid);
end $$;
grant execute on function can_access_evidence_path(text) to authenticated;

-- Membership rows: visible to the engagement owner and to the member
-- themselves; only the engagement owner manages the team.
create policy "team read" on engagement_members for select
  using (can_access_engagement(engagement_id));
create policy "team manage insert" on engagement_members for insert
  with check (exists(select 1 from engagements e where e.id = engagement_id and e.owner = auth.uid()));
create policy "team manage delete" on engagement_members for delete
  using (exists(select 1 from engagements e where e.id = engagement_id and e.owner = auth.uid()));
create policy "team manage update" on engagement_members for update
  using (exists(select 1 from engagements e where e.id = engagement_id and e.owner = auth.uid()));

-- Open the engagement itself to team members (read + save; never delete —
-- deleting an engagement stays with its owner).
create policy "member engagements read" on engagements for select
  using (can_access_engagement(id));
create policy "member engagements update" on engagements for update
  using (can_access_engagement(id)) with check (can_access_engagement(id));
-- a member must never be able to reassign ownership to themselves
revoke update (owner) on table engagements from authenticated;
revoke update (owner) on table engagements from anon;

-- Vault files
create policy "member evidence read" on evidence_files for select
  using (can_access_engagement(engagement_id));
create policy "member evidence insert" on evidence_files for insert
  with check (can_access_engagement(engagement_id));
create policy "member evidence delete" on evidence_files for delete
  using (can_access_engagement(engagement_id));

-- Tick-marks and queries: the whole team works these
create policy "member ticks all" on evidence_ticks for all
  using (can_access_engagement(engagement_id)) with check (can_access_engagement(engagement_id));
create policy "member queries all" on queries for all
  using (can_access_engagement(engagement_id)) with check (can_access_engagement(engagement_id));

-- Activity trail: team can read and append — still nobody can update/delete
create policy "member activity read" on activity_log for select
  using (can_access_engagement(engagement_id));
create policy "member activity insert" on activity_log for insert
  with check (can_access_engagement(engagement_id) and auth.uid() = owner);

-- Storage objects in the evidence bucket
create policy "member evidence storage read" on storage.objects for select
  using (bucket_id = 'evidence' and can_access_evidence_path(name));
create policy "member evidence storage insert" on storage.objects for insert
  with check (bucket_id = 'evidence' and can_access_evidence_path(name));
create policy "member evidence storage delete" on storage.objects for delete
  using (bucket_id = 'evidence' and can_access_evidence_path(name));

create index if not exists idx_members_engagement on engagement_members(engagement_id);
create index if not exists idx_members_email on engagement_members(lower(member_email));
