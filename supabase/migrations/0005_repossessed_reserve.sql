-- A repossessed loan with money still owed keeps reserving her next payments.
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
  where l.child_id = p_child and l.status in ('active','repossessed')
$$;
