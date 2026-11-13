-- The person who runs this copy of the app can get an alert when someone new signs up or starts a family.
-- Set private.config key 'owner_user_id' to that parent's user id (outside this file). Without it, nothing happens.

create or replace function private.owner_id() returns uuid
language sql stable security definer set search_path = public as $$
  select value::uuid from private.config where key = 'owner_user_id'
$$;

create or replace function private.notify_owner(p_title text, p_body text, p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare o uuid; f uuid;
begin
  o := private.owner_id();
  if o is null then return; end if;
  select family_id into f from public.member where user_id = o;
  if f is null then return; end if;
  insert into public.notification(family_id, user_id, title, body, url, dedupe_key)
  values (f, o, p_title, p_body, '/?tab=settings', p_key)
  on conflict (dedupe_key) do nothing;
exception when others then null;  -- an alert must never block a sign-up
end $$;

create or replace function private.on_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.notify_owner('New sign-up', coalesce(new.email, 'Someone') || ' created an account.', 'signup:' || new.id);
  return new;
end $$;
drop trigger if exists owner_alert_signup on auth.users;
create trigger owner_alert_signup after insert on auth.users for each row execute function private.on_user_created();

create or replace function private.on_family_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.notify_owner('New family', 'A family named "' || new.name || '" started using the app.', 'family:' || new.id);
  return new;
end $$;
drop trigger if exists owner_alert_family on public.family;
create trigger owner_alert_family after insert on public.family for each row execute function private.on_family_created();

-- Usage numbers for the owner's Settings screen. Everyone else gets null.
create or replace function public.owner_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o uuid := private.owner_id(); f uuid;
begin
  if o is null or auth.uid() is distinct from o then return null; end if;
  select family_id into f from public.member where user_id = o;
  return jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'other_families', (select count(*) from public.family where id <> f),
    'other_members', (select count(*) from public.member where family_id <> f),
    'entries_7d', (select count(*) from public.entry where family_id <> f and created_at > now() - interval '7 days'),
    'last_signup', (select max(created_at) from auth.users),
    'families', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object('name', fa.name, 'created_at', fa.created_at,
        'members', (select count(*) from public.member m where m.family_id = fa.id),
        'entries', (select count(*) from public.entry e where e.family_id = fa.id),
        'last_entry', (select max(created_at) from public.entry e where e.family_id = fa.id)) x
      from public.family fa where fa.id <> f order by fa.created_at desc limit 20) t), '[]'::jsonb));
end $$;
revoke all on function public.owner_stats() from public, anon;
grant execute on function public.owner_stats() to authenticated;
