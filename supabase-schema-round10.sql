/* ============================================================================
   Round 10 — be able to see what a firm did, and stop three small unfairnesses.

   The first outside firm used Mr Auditor for two days and left. The database
   could say almost nothing about why: four activity rows, no record of which
   screens they opened, and no trace of any error they may have hit. This adds
   the minimum needed to answer that next time — and nothing that identifies a
   client: no account names, no figures, no file names.
   ============================================================================ */

/* ---------- 1. usage events ---------- */

create table if not exists usage_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  user_id    uuid not null default auth.uid(),
  firm_id    uuid,
  session_id text,
  kind       text not null check (kind in ('screen','action','import','error','guide')),
  name       text not null,
  detail     jsonb,
  device     text
);
create index if not exists usage_events_firm_at on usage_events (firm_id, at desc);
create index if not exists usage_events_kind_at on usage_events (kind, at desc);

comment on table usage_events is
  'What a signed-in person did, in outline: screens, actions, errors. Never client data.';

alter table usage_events enable row level security;

/* Write-only for the person it is about. Nobody reads the raw rows through the
   API — not the firm, not another firm. The platform reads a summary below. */
drop policy if exists "log own usage" on usage_events;
create policy "log own usage" on usage_events for insert to authenticated
  with check (user_id = auth.uid());

/* The firm is stamped by the database, not trusted from the browser. */
create or replace function usage_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  select firm_id into new.firm_id from app_users where id = auth.uid();
  new.at := now();
  if new.detail is not null and length(new.detail::text) > 600 then new.detail := null; end if;
  new.name := left(new.name, 80);
  return new;
end $$;
drop trigger if exists trg_usage_stamp on usage_events;
create trigger trg_usage_stamp before insert on usage_events
  for each row execute function usage_stamp();

/* What the platform owner sees: per firm, when they were last here, how far
   they got, where they spent their time, and what went wrong. */
create or replace function usage_summary(days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text; since timestamptz := now() - make_interval(days => greatest(1, least(days, 180)));
begin
  select role into me from app_users where id = auth.uid();
  if me is distinct from 'super_admin' then raise exception 'Platform only'; end if;
  return (
    select coalesce(jsonb_agg(x order by x->>'last_seen' desc nulls last), '[]'::jsonb) from (
      select jsonb_build_object(
        'firm_id', f.id, 'firm', f.name,
        'last_seen', (select max(at) from usage_events e where e.firm_id = f.id),
        'days_active', (select count(distinct (at at time zone 'Asia/Kuala_Lumpur')::date) from usage_events e where e.firm_id = f.id and at >= since),
        'people', (select count(distinct user_id) from usage_events e where e.firm_id = f.id and at >= since),
        'devices', (select coalesce(jsonb_agg(distinct device), '[]'::jsonb) from usage_events e where e.firm_id = f.id and at >= since and device is not null),
        'screens', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'n', n) order by n desc), '[]'::jsonb)
                    from (select name, count(*) n from usage_events e where e.firm_id = f.id and kind = 'screen' and at >= since group by 1 order by 2 desc limit 8) s),
        'last_screens', (select coalesce(jsonb_agg(name order by at desc), '[]'::jsonb)
                    from (select name, at from usage_events e where e.firm_id = f.id and kind = 'screen' order by at desc limit 5) s),
        'imports', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'n', n)), '[]'::jsonb)
                    from (select name, count(*) n from usage_events e where e.firm_id = f.id and kind = 'import' and at >= since group by 1) s),
        'errors', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'm', m, 'n', n, 'last', last) order by last desc), '[]'::jsonb)
                    from (select name, detail->>'m' m, count(*) n, max(at) last from usage_events e
                          where e.firm_id = f.id and kind = 'error' and at >= since group by 1, 2 order by max(at) desc limit 8) s)
      ) x from firms f
    ) q
  );
end $$;
revoke all on function usage_summary(int) from public;
grant execute on function usage_summary(int) to authenticated;

/* ---------- 2. a third way a document gets its folder ---------- */
/* 'user' = the auditor chose; 'ai' = Mr Auditor read the document;
   'auto' = filed from the file's name alone, before anything was read. */
alter table evidence_files drop constraint if exists evidence_files_category_source_check;
alter table evidence_files add constraint evidence_files_category_source_check
  check (category_source in ('user', 'ai', 'auto'));

/* ---------- 3. the demo is not one of the customer's companies ---------- */
/* A firm on a three-company plan that pressed "See the demo" lost a third of
   what it paid for. One demo per firm is free; a second is not a demo. */
create or replace function enforce_company_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare cap int; used int; is_demo boolean;
begin
  if new.firm_id is null then return new; end if;
  if coalesce(btrim(new.name), '') = '' then return new; end if;
  is_demo := coalesce((new.data->>'demo')::boolean, false);
  if tg_op = 'UPDATE' and coalesce(btrim(old.name), '') <> ''
     and coalesce((old.data->>'demo')::boolean, false) = is_demo then return new; end if;

  if is_demo then
    if exists (select 1 from engagements where firm_id = new.firm_id and id <> new.id
               and coalesce((data->>'demo')::boolean, false)) then
      raise exception 'COMPANY_LIMIT_REACHED: the demo is already open in this firm.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select max_companies into cap from firms where id = new.firm_id;
  if cap is null then return new; end if;
  select count(*) into used from engagements
   where firm_id = new.firm_id and id <> new.id
     and coalesce(btrim(name), '') <> ''
     and not coalesce((data->>'demo')::boolean, false);
  if used >= cap then
    raise exception 'COMPANY_LIMIT_REACHED: your plan covers % client compan%. Ask Mr Auditor to raise it.',
      cap, case when cap = 1 then 'y' else 'ies' end using errcode = 'check_violation';
  end if;
  return new;
end $$;

/* The demo files already sitting in customers' firms are demos too. The
   contact address is the demo's own, so a real client that happens to share
   the name is not touched. */
update engagements set data = jsonb_set(data, '{demo}', 'true'::jsonb)
 where name in ('TPO Sdn Bhd', 'Delta Precision Engineering Sdn. Bhd.')
   and not coalesce((data->>'demo')::boolean, false)
   and (data->'intake'->>'email') = 'accounts@tpo.my';

/* Recreated last, so the backfill above is not judged by the rule it sets up. */
drop trigger if exists trg_company_cap on engagements;
create trigger trg_company_cap
  before insert or update of name, firm_id, data on engagements
  for each row execute function enforce_company_cap();
