// Sends queued notifications as Web Push messages.
// Called by the database (pg_net) right after a notification is queued, and by pg_cron every 5 minutes.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@ameliabond.online",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.headers.get("x-push-secret") !== Deno.env.get("PUSH_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }

  const { data: queued, error } = await supabase
    .from("notification")
    .select("id,user_id,title,body,url")
    .is("sent_at", null)
    .gt("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .order("id")
    .limit(100);
  if (error) return new Response(error.message, { status: 500 });
  if (!queued?.length) return Response.json({ sent: 0 });

  // claim the rows first so overlapping runs don't double-send
  const ids = queued.map((n) => n.id);
  await supabase.from("notification").update({ sent_at: new Date().toISOString() }).in("id", ids).is("sent_at", null);

  const userIds = [...new Set(queued.map((n) => n.user_id))];
  const { data: subs } = await supabase.from("push_subscription").select("endpoint,user_id,p256dh,auth").in("user_id", userIds);

  let sent = 0;
  const dead: string[] = [];
  await Promise.all(queued.flatMap((n) =>
    (subs ?? []).filter((s) => s.user_id === n.user_id).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: String(n.id) }),
          { TTL: 3600 },
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.endpoint);
        else console.error("push failed", code, (e as Error).message);
      }
    })
  ));
  if (dead.length) await supabase.from("push_subscription").delete().in("endpoint", dead);
  return Response.json({ sent, removed: dead.length });
});
