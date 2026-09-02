/* ============================================================================
   Round 9 — a plan is a number of companies, and a rank is a real permission.

   Two holes closed, both of them commercial as much as technical:

   1. A firm could register unlimited client companies. Mr Auditor is sold as
      "three companies", so the plan has to be a column the database enforces,
      not a sentence in a WhatsApp message. Existing firms keep what they
      already have — nobody wakes up over their limit.

   2. Any staff member could delete a whole engagement, evidence and all.
      Rank existed (partner / manager / staff) but gated almost nothing.

   And one piece of tidying that makes both of the above make sense: "admin"
   stops being an audit rank. It was silently promoting whoever managed the
   firm's logins to partner — so the person who adds colleagues could also
   sign off files. Admin is now a separate flag that sits alongside a rank.
   ============================================================================ */

/* ---------- 1. the plan ---------- */

alter table firms add column if not exists max_companies integer not null default 3;

comment on column firms.max_companies is
  'How many named client companies this firm''s plan covers. Enforced by trigger, not by the UI.';

/* Nobody becomes retroactively over-limit: an existing firm keeps at least
   what it has already registered. */
update firms f set max_companies = greatest(3, (
  select count(*) from engagements e
  where e.firm_id = f.id and coalesce(btrim(e.name), '') <> ''
));

/* The platform's own firm is not a customer — it demos and tests. */
update firms set max_companies = 999
where id in (select firm_id from app_users where role = 'super_admin' and firm_id is not null);

/* ---------- 2. admin becomes a flag, not a rank ---------- */

alter table app_users add column if not exists is_firm_admin boolean not null default false;

comment on column app_users.is_firm_admin is
  'May create/disable logins and set ranks. Independent of the audit rank in role.';

update app_users set is_firm_admin = true where role in ('admin', 'super_admin');
update app_users set role = 'partner' where role = 'admin';

/* ---------- 3. the cap, enforced ---------- */

create or replace function enforce_company_cap()
returns trigger language plpgsql security definer set search_path = public as $$
declare cap int; used int;
begin
  -- A blank shell is not a company. The cap bites when it is given a name,
  -- which is what "registering a company" actually means in the app.
  if new.firm_id is null then return new; end if;
  if coalesce(btrim(new.name), '') = '' then return new; end if;
  if tg_op = 'UPDATE' and coalesce(btrim(old.name), '') <> '' then return new; end if;

  select max_companies into cap from firms where id = new.firm_id;
  if cap is null then return new; end if;

  select count(*) into used from engagements
   where firm_id = new.firm_id and id <> new.id
     and coalesce(btrim(name), '') <> '';

  if used >= cap then
    raise exception 'COMPANY_LIMIT_REACHED: your plan covers % client compan%. Ask Mr Auditor to raise it.',
      cap, case when cap = 1 then 'y' else 'ies' end
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_company_cap on engagements;
create trigger trg_company_cap
  before insert or update of name, firm_id on engagements
  for each row execute function enforce_company_cap();

/* ---------- 4. only a partner deletes an audit file ---------- */

create or replace function enforce_delete_rank()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text;
begin
  -- Legacy single-user accounts have no profile row and keep working exactly
  -- as before: firm rules only ever apply to people who are in a firm.
  if old.firm_id is null then return old; end if;
  select role into r from app_users where id = auth.uid();
  if r is null then return old; end if;
  if r in ('super_admin', 'partner') then return old; end if;
  raise exception 'RANK_REQUIRED: only a partner can delete an engagement.'
    using errcode = 'check_violation';
end $$;

drop trigger if exists trg_delete_rank on engagements;
create trigger trg_delete_rank
  before delete on engagements
  for each row execute function enforce_delete_rank();
