# Amelia Money

A family money app that teaches kids about earning, spending, borrowing and running a small business. A kid claims chores and tasks, sees what they own, asks a parent before spending, and pays back a parent loan on a real schedule. It installs on Android from Chrome as a PWA.

We built it for our daughter Amelia after the kids' money app we used shut down. It is free to copy and set up for your own family. More about the project: https://www.ameliabond.online

## What it does

- **Jobs.** Parents set up chores, schoolwork and activities with a price and a limit (once every 2 days, at most 2 a day). The kid claims one and the money posts right away. Parents get a notification and can reverse a claim with a note.
- **Quick tasks.** A parent posts a one-off task with a timer. It disappears if nobody claims it.
- **Credit and Available.** Credit is everything the kid owns. Available is credit minus what is due on their loan.
- **Spending.** The kid asks, a parent buys it, and the parent logs the purchase. Gifts and business income the kid enters need a parent's approval.
- **Loans.** A parent sets the amount, optional interest, how often and how long. The app builds the schedule, tracks on-time, late and missed payments, counts strikes, and charts the balance. At the strike limit the item is repossessed and its sale price pays down the loan.
- **Honest records.** Nothing is edited or deleted. A mistake gets a reversal. Parents can export everything to CSV.

## Set it up for your family

Everything runs on free tiers. You need a GitHub account, a free [Supabase](https://supabase.com) project and a free static host such as [Netlify](https://www.netlify.com). An AI coding assistant can do most of this for you if you point it at this README.

### 1. Copy the code

Fork this repo, or download it.

### 2. Create the database

1. Make a new Supabase project.
2. Open the SQL editor. Run each file in `supabase/migrations/` in order, `0001` through the last one.
3. In Authentication settings, turn **Confirm email** off. The app signs in with email and password and never sends email. Set the Site URL to the address you will host the app on.

### 3. Turn on notifications

1. Make a key pair: `npx web-push generate-vapid-keys`
2. Deploy the function in `supabase/functions/push/` (Supabase dashboard or `supabase functions deploy push --no-verify-jwt`).
3. Give the function these secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (like `mailto:you@example.com`) and `PUSH_SECRET` (any long random text).
4. Tell the database where the function is. Run this in the SQL editor with your own values:

```sql
insert into private.config values
  ('push_url', 'https://YOUR-PROJECT.supabase.co/functions/v1/push'),
  ('push_secret', 'THE SAME PUSH_SECRET');
```

### 4. Put the app online

1. In Netlify, import your copy of the repo. The build settings come from `netlify.toml` (base `web`, command `npm run build`, publish `dist`).
2. Add these environment variables in Netlify so the app talks to **your** project, then redeploy:
   - `VITE_SUPABASE_URL`: your Supabase project URL
   - `VITE_SUPABASE_KEY`: your Supabase publishable (anon) key
   - `VITE_VAPID_PUBLIC_KEY`: the public key from step 3
3. Remove the two `[[redirects]]` blocks in `netlify.toml` and the small redirect script at the top of `web/index.html`. They send our own domain to our welcome page.

The values in `web/src/config.js` are our family's public defaults. They are safe to publish because row-level security protects the data, but you must override them or your family's data would try to go to our project.

### 5. Create your family

1. Open your site, create an account, and tap **Start family**.
2. Settings → Invite someone. Make a code for the other parent and one for each kid.
3. Each person creates an account and enters their code. A kid's email can be any address; it is never emailed.
4. Settings → Jobs and pay: add jobs with their limits. Let your kid help set the prices.
5. On each phone: install from Chrome (⋮ → Add to Home screen), then Settings → Turn on notifications.
6. Once everyone has joined, turn off new sign-ups in Supabase Authentication settings so strangers can't create accounts on your project.

## Run it locally

```
cd web
npm install
npm run dev
```

## How it is built

- `web/`: React + Vite PWA. Push notifications run through the service worker in `web/src/sw.js`.
- `web/public/home/`: our static welcome page.
- `supabase/migrations/`: Postgres schema, row-level security and all the money rules.
- `supabase/functions/push/`: Edge Function that sends queued notifications as Web Push.
- `supabase/tests/flow_test.sql`: end-to-end check of the money rules. It runs in a transaction and rolls back.
- `scripts/sql.sh`: runs a SQL file through the Supabase Management API.

## The money rules

These are enforced in the database, not just in the app's buttons.

- Money is whole cents. Balances are never stored; they are sums of entries.
- Entries are never edited or deleted. A mistake gets a reversal with a note.
- A kid cannot write entries directly. They can only claim a job within its limits or send a request a parent approves.
- A loan payment can't be bigger than the kid's credit. If they can't pay, the payment is missed.
- A payment not fully paid by the end of its due date is a strike. Strikes are permanent.
- Each family only sees its own data.

## Sign-up alerts (optional)

To get a phone alert when someone new signs up on your copy, run this in the Supabase SQL editor after you create your family. Use your own display name.

```sql
insert into private.config(key, value)
select 'owner_user_id', user_id::text from public.member where display_name = 'Dad' and role = 'parent';
```

Your Settings tab then shows who is using the app.

## License

MIT. Free to use and change. See `LICENSE`.
