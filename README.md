# Amelia Money

A family money app for Amelia: chores and tasks she claims, money she owns (credit), purchases a parent logs, and a parent loan with a schedule, strikes and a balance chart. Installable on Android as a PWA.

## How it is built

- `web/`: React + Vite PWA. Installs from Chrome ("Add to Home screen"). Push notifications through a service worker (`web/src/sw.js`).
- `supabase/migrations/`: Postgres schema, row-level security and all money rules. Applied in order.
- `supabase/functions/push/`: Edge Function that sends queued notifications as Web Push.
- `supabase/tests/flow_test.sql`: end-to-end check of the money rules. Runs in a transaction and rolls back.
- `scripts/sql.sh`: runs a SQL file against the project through the Supabase Management API.

## Money rules (enforced in the database, not just the app)

- Money is whole cents. Balances are never stored; they are sums of entries.
- Entries are never edited or deleted. A mistake gets a reversal with a note.
- Amelia cannot write entries directly. She can only claim a chore (within its limits) or send a request a parent approves.
- **Credit** = everything she owns. **Available** = credit minus what is past due on her loan and her next payment.
- A loan payment can't be bigger than her credit. If she can't pay, the payment is missed.
- A payment not fully paid by the end of its due date is a strike. Strikes are permanent. At the strike limit (default 3) the app tells parents to repossess; the sale price pays down the loan.
- Notifications: claims go to both parents; new tasks, reversals and approvals go to Amelia; loan due (2 days before) and missed payments go to everyone. A cron job checks every 5 minutes.

## Run locally

```
cd web
npm install
npm run dev
```

The Supabase URL and publishable key are in `web/src/config.js` (safe to ship; row-level security protects the data). Override with `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY`, `VITE_VAPID_PUBLIC_KEY`.

## Deploy

Static hosting (Netlify):
- Base directory: `web`
- Build command: `npm run build`
- Publish directory: `web/dist`
- Domain: `money.ameliabond.online`

Supabase setup that lives outside the repo: Edge Function secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_SECRET`) and the `private.config` rows `push_url` and `push_secret`. Auth uses email + password with email confirmation off, so no email is ever sent.

## First-time setup

1. A parent opens the app, creates an account, then taps "Start a new family".
2. Settings → Invite someone → make a code for the other parent and one for Amelia.
3. Each of them creates an account and enters their code. Amelia's email can be any address, e.g. `amelia@ameliabond.online`; it is never emailed.
4. Settings → Jobs and pay: add chores with their limits. Let Amelia help set the prices.
5. Each person: Settings → Turn on notifications (after installing to the Home screen).
6. Loan tab → New loan.
