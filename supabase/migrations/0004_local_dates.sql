-- Entry dates use the family's own time zone, not UTC, so an evening payment is not counted as tomorrow.
alter table public.entry alter column occurred_on drop default;
alter table public.entry alter column occurred_on drop not null;

create or replace function private.entry_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.occurred_on is null then
    select (now() at time zone timezone)::date into new.occurred_on from public.family where id = new.family_id;
  end if;
  return new;
end $$;
drop trigger if exists entry_defaults on public.entry;
create trigger entry_defaults before insert on public.entry for each row execute function private.entry_defaults();
alter table public.entry add constraint entry_occurred_on_set check (occurred_on is not null) not valid;

create or replace function public.parent_entry(p_child uuid, p_type text, p_amount_cents integer, p_note text,
  p_loan uuid default null, p_occurred_on date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare fam uuid := public.my_family_id(); eid uuid; signed integer;
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
  values (fam, p_child, p_type, signed, p_note, case when p_type in ('loan_payment','repo_sale','loan_disbursement') then p_loan end,
          'approved', p_occurred_on, auth.uid(), now())
  returning id into eid;
  if p_type = 'repo_sale' then update public.loan set status = 'repossessed' where id = p_loan and status in ('active','paid_off'); end if;
  return eid;
end $$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.parent_entry(uuid, text, integer, text, uuid, date) from public, anon;
grant execute on function public.parent_entry(uuid, text, integer, text, uuid, date) to authenticated;
