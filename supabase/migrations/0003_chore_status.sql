-- Chores with when each can next be claimed (null = now), for the child's job list.
create or replace function public.chore_status() returns table(
  id uuid, name text, type text, amount_cents integer, min_hours_between numeric, max_per_day integer,
  expires_at timestamptz, active boolean, next_available timestamptz, claims_today integer)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.type, c.amount_cents, c.min_hours_between, c.max_per_day, c.expires_at, c.active,
    public.chore_next_available(c.id),
    (select count(*)::integer from public.entry e join public.family f on f.id = c.family_id
      where e.chore_id = c.id and e.status = 'approved'
        and e.created_at >= date_trunc('day', now() at time zone f.timezone) at time zone f.timezone
        and not exists (select 1 from public.entry r where r.reverses_entry_id = e.id))
  from public.chore c
  where c.family_id = public.my_family_id()
  order by (c.type = 'task') desc, c.expires_at, c.type, c.amount_cents desc, c.name
$$;
revoke execute on function public.chore_status() from public, anon;
grant execute on function public.chore_status() to authenticated;
