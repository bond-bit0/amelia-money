-- Push delivery: queue -> pg_net -> Edge Function "push". pg_cron runs the scheduled checks.
-- private.config must hold push_url and push_secret (set outside this file, never committed).
create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function private.kick_push() returns void
language plpgsql security definer set search_path = public as $$
declare u text; s text;
begin
  select value into u from private.config where key = 'push_url';
  select value into s from private.config where key = 'push_secret';
  if u is null or s is null then return; end if;
  perform net.http_post(url := u, body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','x-push-secret', s));
end $$;

create or replace function private.notification_queued() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.kick_push();
  return null;
end $$;

drop trigger if exists notification_queued on public.notification;
create trigger notification_queued after insert on public.notification
  for each statement execute function private.notification_queued();

revoke execute on all functions in schema private from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'amelia-checks';
select cron.schedule('amelia-checks', '*/5 * * * *', $$select private.run_checks(); select private.kick_push();$$);
