-- Amelia Money: core schema
-- Money is stored in whole cents. Entries are append-only; mistakes get a reversal entry.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------- tables

create table public.family (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Chicago',
  created_at timestamptz not null default now()
);

create table public.member (
  user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references public.family(id) on delete cascade,
  role text not null check (role in ('parent','child')),
  display_name text not null,
  created_at timestamptz not null default now()
);
create index on public.member(family_id);

create table public.invite (
  code text primary key,
  family_id uuid not null references public.family(id) on delete cascade,
  role text not null check (role in ('parent','child')),
  display_name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users(id),
  used_at timestamptz
);

-- Standing chores (and schoolwork / activities) plus one-off tasks.
create table public.chore (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family(id) on delete cascade,
  name text not null,
  type text not null default 'chore' check (type in ('chore','schoolwork','activity','task')),
  amount_cents integer not null check (amount_cents > 0),
  min_hours_between numeric check (min_hours_between is null or min_hours_between >= 0),
  max_per_day integer check (max_per_day is null or max_per_day > 0),
  expires_at timestamptz,            -- one-off tasks only
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check ((type = 'task') = (expires_at is not null))
);
create index on public.chore(family_id);

create table public.loan (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family(id) on delete cascade,
  child_id uuid not null references public.member(user_id),
  name text not null,                 -- what the loan bought
  principal_cents integer not null check (principal_cents > 0),
  apr numeric not null default 0 check (apr >= 0 and apr < 1),   -- 0.05 = 5%
  frequency text not null check (frequency in ('weekly','biweekly','monthly')),
  num_payments integer not null check (num_payments between 1 and 520),
  first_due_date date not null,
  payment_cents integer not null check (payment_cents > 0),
  strike_limit integer not null default 3 check (strike_limit > 0),
  status text not null default 'active' check (status in ('active','paid_off','repossessed','closed')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index on public.loan(family_id);

create table public.loan_schedule (
  loan_id uuid not null references public.loan(id) on delete cascade,
  payment_no integer not null,
  due_date date not null,
  payment_cents integer not null,
  interest_cents integer not null,
  principal_cents integer not null,
  balance_after_cents integer not null,
  -- derived from approved payment entries by private.apply_loan_payments
  paid_cents integer not null default 0,
  paid_date date,
  days_late integer,
  status text not null default 'upcoming' check (status in ('upcoming','on_time','late','partial','missed')),
  -- permanent: once a payment is struck it stays struck
  struck_at timestamptz,
  parent_note text,
  primary key (loan_id, payment_no)
);

create table public.entry (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.family(id) on delete cascade,
  child_id uuid not null references public.member(user_id),
  type text not null check (type in (
    'chore','schoolwork','activity','task',        -- earned
    'gift','business',                             -- received
    'purchase','cash_out',                         -- spent
    'loan_disbursement','loan_payment','repo_sale',-- loan
    'adjustment','reversal')),
  amount_cents integer not null check (amount_cents <> 0),
  note text,
  chore_id uuid references public.chore(id),
  loan_id uuid references public.loan(id),
  reverses_entry_id uuid unique references public.entry(id),
  status text not null default 'approved' check (status in ('pending','approved','rejected')),
  occurred_on date not null default current_date,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text
);
create index on public.entry(family_id, created_at desc);
create index on public.entry(chore_id, created_at desc);
create index on public.entry(loan_id);

create table public.push_subscription (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table public.notification (
  id bigserial primary key,
  family_id uuid not null references public.family(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  url text not null default '/',
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz
);
create index on public.notification(user_id, created_at desc);
create index on public.notification(sent_at) where sent_at is null;

create table public.audit_log (
  id bigserial primary key,
  family_id uuid,
  actor uuid,
  action text not null,
  table_name text not null,
  row_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_log(family_id, created_at desc);

create table private.config (
  key text primary key,
  value text not null
);

-- ---------------------------------------------------------------- helpers

create or replace function public.my_family_id() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from public.member where user_id = auth.uid()
$$;

create or replace function public.is_parent() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.member where user_id = auth.uid() and role = 'parent')
$$;

create or replace function public.money(cents integer) returns text
language sql immutable as $$
  select case when cents < 0 then '-' else '' end || '$' || to_char(abs(cents) / 100.0, 'FM999999990.00')
$$;

-- credit = every approved entry except repossession sales (those pay the loan, not her)
create or replace function public.child_credit(p_child uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount_cents), 0)::integer from public.entry
  where child_id = p_child and status = 'approved' and type <> 'repo_sale'
$$;

-- money set aside for loans: everything past due and unpaid, plus the next upcoming payment
create or replace function public.child_reserved(p_child uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(
    (select coalesce(sum(s.payment_cents - s.paid_cents), 0) from public.loan_schedule s
      where s.loan_id = l.id and s.due_date < (now() at time zone f.timezone)::date)
    + coalesce((select s.payment_cents - s.paid_cents from public.loan_schedule s
      where s.loan_id = l.id and s.due_date >= (now() at time zone f.timezone)::date and s.paid_cents < s.payment_cents
      order by s.payment_no limit 1), 0)
  ), 0)::integer
  from public.loan l join public.family f on f.id = l.family_id
  where l.child_id = p_child and l.status = 'active'
$$;

create or replace function private.notify(p_family uuid, p_user uuid, p_title text, p_body text, p_url text default '/', p_key text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.notification(family_id, user_id, title, body, url, dedupe_key)
  values (p_family, p_user, p_title, p_body, p_url, p_key)
  on conflict (dedupe_key) do nothing
$$;

create or replace function private.notify_parents(p_family uuid, p_title text, p_body text, p_url text default '/', p_key text default null)
returns void language plpgsql security definer set search_path = public as $$
declare m record;
begin
  for m in select user_id from public.member where family_id = p_family and role = 'parent' loop
    perform private.notify(p_family, m.user_id, p_title, p_body, p_url, case when p_key is null then null else p_key || ':' || m.user_id end);
  end loop;
end $$;

-- ---------------------------------------------------------------- audit

create or replace function private.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare fam uuid; rid text;
begin
  if tg_op = 'DELETE' then
    fam := (to_jsonb(old)->>'family_id')::uuid;
    rid := coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'user_id', to_jsonb(old)->>'loan_id');
  else
    fam := (to_jsonb(new)->>'family_id')::uuid;
    rid := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'user_id', to_jsonb(new)->>'loan_id');
  end if;
  if fam is null and tg_table_name = 'loan_schedule' then
    select family_id into fam from public.loan where id = coalesce(new.loan_id, old.loan_id);
  end if;
  insert into public.audit_log(family_id, actor, action, table_name, row_id, before, after)
  values (fam, auth.uid(), lower(tg_op), tg_table_name, rid,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end $$;

create trigger audit_member after insert or update or delete on public.member for each row execute function private.audit();
create trigger audit_chore after insert or update or delete on public.chore for each row execute function private.audit();
create trigger audit_loan after insert or update or delete on public.loan for each row execute function private.audit();
create trigger audit_entry after insert or update on public.entry for each row execute function private.audit();
create trigger audit_family after update on public.family for each row execute function private.audit();
-- loan_schedule: only audit parent notes (status updates are derived)
create trigger audit_schedule_note after update of parent_note on public.loan_schedule for each row execute function private.audit();

-- ---------------------------------------------------------------- entry guard rails

create or replace function private.entry_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Entries are never deleted. Reverse it instead.';
  end if;
  -- only a pending entry can change, and only its decision fields
  if old.status <> 'pending' then
    raise exception 'This entry is final. Reverse it instead.';
  end if;
  if (to_jsonb(new) - array['status','decided_by','decided_at','decision_note'])
     <> (to_jsonb(old) - array['status','decided_by','decided_at','decision_note']) then
    raise exception 'Only the approval decision can change on an entry.';
  end if;
  return new;
end $$;
create trigger entry_guard before update or delete on public.entry for each row execute function private.entry_guard();

-- ---------------------------------------------------------------- loan math

create or replace function private.add_period(d date, freq text, n integer) returns date
language sql immutable as $$
  select case freq
    when 'weekly' then d + 7 * n
    when 'biweekly' then d + 14 * n
    else (d + make_interval(months => n))::date end
$$;

create or replace function private.periods_per_year(freq text) returns integer
language sql immutable as $$ select case freq when 'weekly' then 52 when 'biweekly' then 26 else 12 end $$;

-- Builds the schedule for a loan from its terms. The last payment absorbs rounding.
create or replace function private.build_schedule(p_loan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.loan; r numeric; bal integer; i integer; int_c integer; prin integer; pay integer;
begin
  select * into l from public.loan where id = p_loan;
  delete from public.loan_schedule where loan_id = p_loan;
  r := l.apr / private.periods_per_year(l.frequency);
  bal := l.principal_cents;
  for i in 1..l.num_payments loop
    exit when bal <= 0;
    int_c := round(bal * r)::integer;
    pay := l.payment_cents;
    if i = l.num_payments or pay >= bal + int_c then
      pay := bal + int_c;
    end if;
    prin := pay - int_c;
    bal := bal - prin;
    insert into public.loan_schedule(loan_id, payment_no, due_date, payment_cents, interest_cents, principal_cents, balance_after_cents)
    values (p_loan, i, private.add_period(l.first_due_date, l.frequency, i - 1), pay, int_c, prin, bal);
  end loop;
end $$;

-- Allocates approved loan payments (oldest first) across the schedule and sets each row's status.
-- A reversed payment is ignored. Strikes are permanent: a row that was ever a full day late keeps struck_at.
create or replace function private.apply_loan_payments(p_loan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.loan; tz text; today date; s record;
  amts integer[]; dates date[]; n integer; idx integer := 1; avail integer := 0; adate date;
  covered integer; take integer; last_date date; st text; dl integer; total_paid integer; total_due integer;
begin
  select * into l from public.loan where id = p_loan;
  if l.id is null then return; end if;
  select timezone into tz from public.family where id = l.family_id;
  today := (now() at time zone tz)::date;

  select coalesce(array_agg(amt order by d, ca), '{}'), coalesce(array_agg(d order by d, ca), '{}') into amts, dates from (
    select abs(e.amount_cents) as amt, e.occurred_on as d, e.created_at as ca
    from public.entry e
    where e.loan_id = p_loan and e.status = 'approved' and e.type in ('loan_payment','repo_sale')
      and not exists (select 1 from public.entry r where r.reverses_entry_id = e.id)
  ) x;
  n := coalesce(array_length(amts, 1), 0);

  for s in select * from public.loan_schedule where loan_id = p_loan order by payment_no loop
    covered := 0; last_date := null;
    while covered < s.payment_cents loop
      if avail = 0 then
        exit when idx > n;
        avail := amts[idx]; adate := dates[idx]; idx := idx + 1;
      end if;
      take := least(avail, s.payment_cents - covered);
      covered := covered + take; avail := avail - take; last_date := adate;
    end loop;

    if covered >= s.payment_cents then
      dl := greatest(0, last_date - s.due_date);
      st := case when dl = 0 then 'on_time' else 'late' end;
    elsif s.due_date < today then
      dl := today - s.due_date;
      st := case when covered > 0 then 'partial' else 'missed' end;
    else
      dl := null;
      st := case when covered > 0 then 'partial' else 'upcoming' end;
    end if;

    update public.loan_schedule set
      paid_cents = covered,
      paid_date = case when covered >= s.payment_cents then last_date end,
      days_late = dl,
      status = st,
      struck_at = coalesce(struck_at, case when coalesce(dl, 0) >= 1 then now() end)
    where loan_id = p_loan and payment_no = s.payment_no;
  end loop;

  select coalesce(sum(paid_cents),0), coalesce(sum(payment_cents),0) into total_paid, total_due
  from public.loan_schedule where loan_id = p_loan;
  if l.status = 'active' and total_paid >= total_due then
    update public.loan set status = 'paid_off' where id = p_loan;
  elsif l.status = 'paid_off' and total_paid < total_due then
    update public.loan set status = 'active' where id = p_loan;
  end if;
end $$;

create or replace function private.entry_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  lid := new.loan_id;
  if lid is null and new.reverses_entry_id is not null then
    select loan_id into lid from public.entry where id = new.reverses_entry_id;
  end if;
  if lid is not null then
    perform private.apply_loan_payments(lid);
  end if;
  return null;
end $$;
create trigger entry_after after insert or update on public.entry for each row execute function private.entry_after();

-- ---------------------------------------------------------------- RPCs

create or replace function public.create_family(p_family_name text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare fid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if exists (select 1 from public.member where user_id = auth.uid()) then
    raise exception 'You are already in a family.';
  end if;
  insert into public.family(name) values (p_family_name) returning id into fid;
  insert into public.member(user_id, family_id, role, display_name) values (auth.uid(), fid, 'parent', p_display_name);
  return fid;
end $$;

create or replace function public.create_invite(p_role text, p_display_name text) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.is_parent() then raise exception 'Only a parent can invite.'; end if;
  c := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 6));
  insert into public.invite(code, family_id, role, display_name, created_by)
  values (c, public.my_family_id(), p_role, p_display_name, auth.uid());
  return c;
end $$;

create or replace function public.join_family(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i public.invite;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if exists (select 1 from public.member where user_id = auth.uid()) then
    raise exception 'You are already in a family.';
  end if;
  select * into i from public.invite where code = upper(trim(p_code)) for update;
  if i.code is null or i.used_by is not null or i.expires_at < now() then
    raise exception 'That code is not valid. Ask a parent for a new one.';
  end if;
  insert into public.member(user_id, family_id, role, display_name) values (auth.uid(), i.family_id, i.role, i.display_name);
  update public.invite set used_by = auth.uid(), used_at = now() where code = i.code;
  return i.family_id;
end $$;

-- When can this chore next be claimed? null = now.
create or replace function public.chore_next_available(p_chore uuid) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare c public.chore; tz text; last_at timestamptz; today_count integer; t timestamptz := null; day_start timestamptz;
begin
  select * into c from public.chore where id = p_chore;
  select timezone into tz from public.family where id = c.family_id;
  -- reversed claims don't count against the limit
  select max(e.created_at) into last_at from public.entry e
  where e.chore_id = p_chore and e.status = 'approved'
    and not exists (select 1 from public.entry r where r.reverses_entry_id = e.id);
  if c.type = 'task' then
    if last_at is not null then return 'infinity'; end if;
    return null;
  end if;
  if c.min_hours_between is not null and last_at is not null
     and last_at + make_interval(secs => c.min_hours_between * 3600) > now() then
    t := last_at + make_interval(secs => c.min_hours_between * 3600);
  end if;
  if c.max_per_day is not null then
    day_start := date_trunc('day', now() at time zone tz) at time zone tz;
    select count(*) into today_count from public.entry e
    where e.chore_id = p_chore and e.status = 'approved' and e.created_at >= day_start
      and not exists (select 1 from public.entry r where r.reverses_entry_id = e.id);
    if today_count >= c.max_per_day then
      t := greatest(coalesce(t, '-infinity'), day_start + interval '1 day');
    end if;
  end if;
  return t;
end $$;

create or replace function public.claim_chore(p_chore uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.chore; me public.member; eid uuid; nxt timestamptz;
begin
  select * into me from public.member where user_id = auth.uid();
  if me.user_id is null or me.role <> 'child' then raise exception 'Only a child can claim chores.'; end if;
  select * into c from public.chore where id = p_chore and family_id = me.family_id for update;
  if c.id is null or not c.active then raise exception 'That chore is not available.'; end if;
  if c.type = 'task' and c.expires_at < now() then raise exception 'That task expired.'; end if;
  nxt := public.chore_next_available(p_chore);
  if nxt is not null then raise exception 'Not yet. You can claim this again later.'; end if;
  insert into public.entry(family_id, child_id, type, amount_cents, note, chore_id, status)
  values (me.family_id, me.user_id, c.type, c.amount_cents, c.name, c.id, 'approved')
  returning id into eid;
  if c.type = 'task' then update public.chore set active = false where id = c.id; end if;
  perform private.notify_parents(me.family_id, me.display_name || ' claimed ' || c.name,
    '+' || public.money(c.amount_cents) || ' at ' || to_char(now() at time zone (select timezone from family where id = me.family_id), 'FMHH12:MI AM'),
    '/?tab=activity');
  return eid;
end $$;

-- Child asks for something to be added or taken out; a parent approves.
create or replace function public.submit_request(p_type text, p_amount_cents integer, p_note text, p_loan uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.member; eid uuid; signed integer;
begin
  select * into me from public.member where user_id = auth.uid();
  if me.user_id is null or me.role <> 'child' then raise exception 'Only a child submits requests.'; end if;
  if p_type not in ('gift','business','purchase','cash_out','loan_payment') then raise exception 'Not allowed.'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'Enter an amount.'; end if;
  if p_type = 'loan_payment' and not exists (select 1 from public.loan where id = p_loan and child_id = me.user_id) then
    raise exception 'Pick a loan.';
  end if;
  signed := case when p_type in ('gift','business') then p_amount_cents else -p_amount_cents end;
  insert into public.entry(family_id, child_id, type, amount_cents, note, loan_id, status)
  values (me.family_id, me.user_id, p_type, signed, p_note, case when p_type = 'loan_payment' then p_loan end, 'pending')
  returning id into eid;
  perform private.notify_parents(me.family_id, me.display_name || ' needs a yes or no',
    initcap(replace(p_type,'_',' ')) || ' ' || public.money(abs(signed)) || coalesce(': ' || p_note, ''), '/?tab=home');
  return eid;
end $$;

-- Parent logs money in or out. Posts instantly.
create or replace function public.parent_entry(p_child uuid, p_type text, p_amount_cents integer, p_note text,
  p_loan uuid default null, p_occurred_on date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare fam uuid := public.my_family_id(); eid uuid; signed integer; kid text;
begin
  if not public.is_parent() then raise exception 'Only a parent can do that.'; end if;
  if not exists (select 1 from public.member where user_id = p_child and family_id = fam and role = 'child') then
    raise exception 'Pick a child.';
  end if;
  if p_type not in ('chore','schoolwork','activity','gift','business','purchase','cash_out','loan_disbursement','loan_payment','repo_sale','adjustment') then
    raise exception 'Not allowed.';
  end if;
  if p_amount_cents is null or p_amount_cents = 0 then raise exception 'Enter an amount.'; end if;
  if p_type in ('loan_payment','repo_sale','loan_disbursement')
     and not exists (select 1 from public.loan where id = p_loan and child_id = p_child) then
    raise exception 'Pick a loan.';
  end if;
  signed := case
    when p_type = 'adjustment' then p_amount_cents
    when p_type in ('purchase','cash_out','loan_payment') then -abs(p_amount_cents)
    else abs(p_amount_cents) end;
  insert into public.entry(family_id, child_id, type, amount_cents, note, loan_id, status, occurred_on, decided_by, decided_at)
  values (fam, p_child, p_type, signed, p_note, p_loan, 'approved', coalesce(p_occurred_on, current_date), auth.uid(), now())
  returning id into eid;
  if p_type = 'repo_sale' then update public.loan set status = 'repossessed' where id = p_loan and status = 'active'; end if;
  return eid;
end $$;

create or replace function public.decide_entry(p_entry uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare e public.entry;
begin
  if not public.is_parent() then raise exception 'Only a parent can approve.'; end if;
  select * into e from public.entry where id = p_entry and family_id = public.my_family_id();
  if e.id is null or e.status <> 'pending' then raise exception 'Nothing to decide.'; end if;
  update public.entry set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = p_entry;
  perform private.notify(e.family_id, e.child_id,
    case when p_approve then 'Approved: ' else 'Not approved: ' end || initcap(replace(e.type,'_',' ')) || ' ' || public.money(abs(e.amount_cents)),
    coalesce(p_note, coalesce(e.note, '')), '/?tab=activity');
end $$;

create or replace function public.reverse_entry(p_entry uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare e public.entry; rid uuid;
begin
  if not public.is_parent() then raise exception 'Only a parent can reverse.'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Add a note so she knows why.'; end if;
  select * into e from public.entry where id = p_entry and family_id = public.my_family_id();
  if e.id is null or e.status <> 'approved' or e.type = 'reversal' then raise exception 'That entry cannot be reversed.'; end if;
  if exists (select 1 from public.entry where reverses_entry_id = p_entry) then raise exception 'Already reversed.'; end if;
  insert into public.entry(family_id, child_id, type, amount_cents, note, reverses_entry_id, status, decided_by, decided_at)
  values (e.family_id, e.child_id, 'reversal', -e.amount_cents, p_note, e.id, 'approved', auth.uid(), now())
  returning id into rid;
  perform private.notify(e.family_id, e.child_id, 'Reversed: ' || coalesce(e.note, initcap(e.type)) || ' ' || public.money(-e.amount_cents),
    p_note, '/?tab=activity');
  return rid;
end $$;

create or replace function public.create_task(p_name text, p_amount_cents integer, p_hours numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; fam uuid := public.my_family_id(); k record;
begin
  if not public.is_parent() then raise exception 'Only a parent can add tasks.'; end if;
  if p_hours is null or p_hours <= 0 then raise exception 'Set a time limit.'; end if;
  insert into public.chore(family_id, name, type, amount_cents, expires_at, created_by)
  values (fam, p_name, 'task', p_amount_cents, now() + make_interval(secs => p_hours * 3600), auth.uid())
  returning id into cid;
  for k in select user_id from public.member where family_id = fam and role = 'child' loop
    perform private.notify(fam, k.user_id, 'New task: ' || p_name, public.money(p_amount_cents) || ' if you finish in ' ||
      case when p_hours < 1 then round(p_hours*60)::text || ' minutes' else trim(to_char(p_hours, 'FM990.##')) || ' hours' end, '/?tab=home');
  end loop;
  return cid;
end $$;

-- Parent creates a loan; the schedule is generated. Payment amount is computed when p_payment_cents is null,
-- otherwise the number of payments is worked out from it.
create or replace function public.create_loan(p_child uuid, p_name text, p_principal_cents integer, p_apr numeric,
  p_frequency text, p_num_payments integer, p_first_due date, p_payment_cents integer default null,
  p_strike_limit integer default 3, p_credit_child boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare fam uuid := public.my_family_id(); lid uuid; r numeric; n integer; pay integer; bal integer; guard integer := 0;
begin
  if not public.is_parent() then raise exception 'Only a parent can create a loan.'; end if;
  if not exists (select 1 from public.member where user_id = p_child and family_id = fam and role = 'child') then
    raise exception 'Pick a child.';
  end if;
  r := coalesce(p_apr, 0) / private.periods_per_year(p_frequency);
  if p_payment_cents is not null then
    pay := p_payment_cents;
    -- work out n by simulation
    bal := p_principal_cents; n := 0;
    while bal > 0 loop
      n := n + 1; guard := guard + 1;
      if pay <= round(bal * r) then raise exception 'That payment never pays off the loan.'; end if;
      bal := bal + round(bal * r)::integer - pay;
      exit when guard > 520;
    end loop;
    if guard > 520 then raise exception 'Too many payments.'; end if;
  else
    n := p_num_payments;
    if n is null or n < 1 then raise exception 'Set the number of payments.'; end if;
    if r = 0 then
      pay := ceil(p_principal_cents::numeric / n)::integer;
    else
      pay := ceil(r * p_principal_cents / (1 - power(1 + r, -n)))::integer;
    end if;
  end if;
  insert into public.loan(family_id, child_id, name, principal_cents, apr, frequency, num_payments, first_due_date, payment_cents, strike_limit, created_by)
  values (fam, p_child, p_name, p_principal_cents, coalesce(p_apr,0), p_frequency, n, p_first_due, pay, coalesce(p_strike_limit,3), auth.uid())
  returning id into lid;
  perform private.build_schedule(lid);
  perform private.apply_loan_payments(lid);
  if p_credit_child then
    insert into public.entry(family_id, child_id, type, amount_cents, note, loan_id, status, decided_by, decided_at)
    values (fam, p_child, 'loan_disbursement', p_principal_cents, 'Loan: ' || p_name, lid, 'approved', auth.uid(), now());
  end if;
  return lid;
end $$;

create or replace function public.set_schedule_note(p_loan uuid, p_payment_no integer, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_parent() then raise exception 'Only a parent can add notes.'; end if;
  update public.loan_schedule s set parent_note = p_note
  from public.loan l where l.id = s.loan_id and l.family_id = public.my_family_id()
    and s.loan_id = p_loan and s.payment_no = p_payment_no;
end $$;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language sql security definer set search_path = public as $$
  insert into public.push_subscription(endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
$$;

-- Balances for everyone in my family (children only).
create or replace function public.balances() returns table(child_id uuid, display_name text, credit_cents integer, reserved_cents integer, available_cents integer)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.display_name, public.child_credit(m.user_id), public.child_reserved(m.user_id),
         public.child_credit(m.user_id) - public.child_reserved(m.user_id)
  from public.member m where m.family_id = public.my_family_id() and m.role = 'child'
  order by m.created_at
$$;

-- ---------------------------------------------------------------- scheduled checks (run by pg_cron)

create or replace function private.run_checks() returns void
language plpgsql security definer set search_path = public as $$
declare l record; s record; t record; kidname text; fam_tz text; today date;
begin
  -- refresh every active loan (marks missed / strikes as days pass)
  for l in select * from public.loan where status = 'active' loop
    perform private.apply_loan_payments(l.id);
    select timezone into fam_tz from public.family where id = l.family_id;
    today := (now() at time zone fam_tz)::date;
    select display_name into kidname from public.member where user_id = l.child_id;
    -- due in 2 days
    for s in select * from public.loan_schedule where loan_id = l.id and due_date = today + 2 and paid_cents < payment_cents loop
      perform private.notify(l.family_id, l.child_id, 'Loan payment due in 2 days',
        public.money(s.payment_cents - s.paid_cents) || ' for ' || l.name || ' on ' || to_char(s.due_date, 'Mon FMDD'), '/?tab=loan', 'due:' || l.id || ':' || s.payment_no);
      perform private.notify_parents(l.family_id, kidname || '''s loan payment is due in 2 days',
        public.money(s.payment_cents - s.paid_cents) || ' for ' || l.name, '/?tab=loan', 'due:' || l.id || ':' || s.payment_no);
    end loop;
    -- missed (strike) the day after the due date
    for s in select * from public.loan_schedule where loan_id = l.id and struck_at is not null and due_date < today and status in ('missed','partial') loop
      perform private.notify(l.family_id, l.child_id, 'Missed loan payment: strike ' ||
        (select count(*) from public.loan_schedule where loan_id = l.id and struck_at is not null) || ' of ' || l.strike_limit,
        'Payment ' || s.payment_no || ' for ' || l.name || ' was due ' || to_char(s.due_date, 'Mon FMDD'), '/?tab=loan', 'strike:' || l.id || ':' || s.payment_no);
      perform private.notify_parents(l.family_id, kidname || ' missed a loan payment',
        'Strike ' || (select count(*) from public.loan_schedule where loan_id = l.id and struck_at is not null) || ' of ' || l.strike_limit || ' on ' || l.name,
        '/?tab=loan', 'strike:' || l.id || ':' || s.payment_no);
    end loop;
  end loop;

  -- one-off tasks: warn 30 minutes before expiry, deactivate when expired
  for t in select * from public.chore where type = 'task' and active and expires_at between now() and now() + interval '30 minutes' loop
    perform private.notify(t.family_id, m.user_id, 'Task ending soon: ' || t.name, 'Less than 30 minutes left for ' || public.money(t.amount_cents), '/?tab=home', 'expiring:' || t.id || ':' || m.user_id)
    from public.member m where m.family_id = t.family_id and m.role = 'child';
  end loop;
  update public.chore set active = false where type = 'task' and active and expires_at < now();
end $$;

-- ---------------------------------------------------------------- RLS

alter table public.family enable row level security;
alter table public.member enable row level security;
alter table public.invite enable row level security;
alter table public.chore enable row level security;
alter table public.loan enable row level security;
alter table public.loan_schedule enable row level security;
alter table public.entry enable row level security;
alter table public.push_subscription enable row level security;
alter table public.notification enable row level security;
alter table public.audit_log enable row level security;

create policy family_read on public.family for select using (id = public.my_family_id());
create policy family_update on public.family for update using (id = public.my_family_id() and public.is_parent());

create policy member_read on public.member for select using (family_id = public.my_family_id());
create policy member_update on public.member for update using (family_id = public.my_family_id() and public.is_parent())
  with check (family_id = public.my_family_id());
create policy member_delete on public.member for delete using (family_id = public.my_family_id() and public.is_parent() and user_id <> auth.uid());

create policy invite_read on public.invite for select using (family_id = public.my_family_id() and public.is_parent());
create policy invite_delete on public.invite for delete using (family_id = public.my_family_id() and public.is_parent());

create policy chore_read on public.chore for select using (family_id = public.my_family_id());
create policy chore_insert on public.chore for insert with check (family_id = public.my_family_id() and public.is_parent() and created_by = auth.uid());
create policy chore_update on public.chore for update using (family_id = public.my_family_id() and public.is_parent())
  with check (family_id = public.my_family_id());

create policy loan_read on public.loan for select using (family_id = public.my_family_id());
create policy loan_update on public.loan for update using (family_id = public.my_family_id() and public.is_parent())
  with check (family_id = public.my_family_id());

create policy schedule_read on public.loan_schedule for select using (
  exists (select 1 from public.loan l where l.id = loan_id and l.family_id = public.my_family_id()));

-- No direct inserts/updates on entry from clients: everything goes through the RPCs above.
create policy entry_read on public.entry for select using (family_id = public.my_family_id());

create policy push_own on public.push_subscription for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notification_read on public.notification for select using (user_id = auth.uid());
create policy notification_mark_read on public.notification for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy audit_read on public.audit_log for select using (family_id = public.my_family_id() and public.is_parent());

-- table privileges: read through RLS; most writes go through the RPCs above
revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.entry, public.loan_schedule, public.audit_log, public.invite, public.family,
  public.loan, public.notification, public.member from authenticated;
grant update (name, timezone) on public.family to authenticated;
grant update (read_at) on public.notification to authenticated;
grant update (status, name) on public.loan to authenticated;
grant update (display_name, role) on public.member to authenticated;
grant delete on public.member, public.invite to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

-- realtime for live updates
alter publication supabase_realtime add table public.entry, public.chore, public.loan_schedule, public.notification;
