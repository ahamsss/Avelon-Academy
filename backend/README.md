# Avelon Academy backend (Supabase)

Everything the family/tutor portal needs: the database, security rules, the 5 backend
functions (Stripe cards and weekly billing, class logging, email confirmations) and the
scheduled jobs. The website (in the repo root and `portal/`) talks to it over Supabase's API.

```
backend/
├── supabase/
│   ├── config.toml                  # project settings (JWT check off: each function checks access itself)
│   ├── migrations/
│   │   └── 20261107000000_init.sql  # tables, row-level security, actions
│   └── functions/
│       ├── create-card-session/     # opens Stripe's "save a card" page
│       ├── stripe-webhook/          # Stripe: card saved / payment succeeded or failed
│       ├── log-session/             # tutor logs a class -> confirmation email
│       ├── approve-session/         # "Yes, confirm class" / "Something's wrong" links
│       └── weekly-billing/          # every Monday: charge confirmed classes, send receipts
├── schedules.sql                    # hourly auto-confirm + Monday billing (run once, by hand)
└── .env.example                     # the secrets the functions need (copy to .env, never commit)
```

## Deploy (about 15 minutes)

You need: a Supabase project (region **Canada (Central)**), Node.js installed, and your
Stripe and Resend keys. Run these from this `backend` folder in a terminal (VS Code: Terminal → New Terminal, then `cd backend`):

```bash
npx supabase login                               # opens the browser to sign in
npx supabase link --project-ref YOUR-PROJECT-REF # the letters in https://YOUR-PROJECT-REF.supabase.co
npx supabase db push                             # creates the tables and security rules
cp .env.example .env                             # then open .env and fill in your keys
npx supabase secrets set --env-file .env         # uploads the secrets to Supabase
npx supabase functions deploy                    # deploys all 5 functions
```

Then, in the Supabase dashboard:

1. **SQL Editor:** open `schedules.sql`, replace `YOUR-PROJECT-REF` and `YOUR-CRON-SECRET`, run it.
   (If it says an extension is missing: Database → Extensions → turn on `pg_cron` and `pg_net`.)
2. **Authentication → URL Configuration:** Site URL `https://avelonacademy.ca`, redirect URL `https://avelonacademy.ca/portal/`.
3. **Authentication → Emails → SMTP:** host `smtp.resend.com`, port `465`, user `resend`, password = Resend key, sender `classes@avelonacademy.ca`.
4. **Stripe → Webhooks:** endpoint `https://YOUR-PROJECT-REF.supabase.co/functions/v1/stripe-webhook`,
   events `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`.
   Put its `whsec_` secret in `.env` and run `npx supabase secrets set --env-file .env` again.
5. Paste the project URL and the **publishable (anon) key** into `portal/index.html` and `approve.html`
   (the `SUPABASE_URL` / `SUPABASE_KEY` lines). The publishable key is safe to be public; the others are not.
6. Sign in at `avelonacademy.ca/portal/`, then in **Table Editor → profiles** set your `role` to `admin`.

## Keeping the free plan awake

Free Supabase projects pause after 7 days with no requests. Until you move to Pro, create a free
job at cron-job.org that opens this URL once a day:

```
https://YOUR-PROJECT-REF.supabase.co/rest/v1/
```
with header `apikey: YOUR-PUBLISHABLE-KEY`. The free plan has no automatic backups:
export your tables (Table Editor → Export to CSV) every week or two.

## Changing things later

- Database change: add a new file in `supabase/migrations/` (newer timestamp), then `npx supabase db push`.
- Function change: edit its `index.ts`, then `npx supabase functions deploy <name>`.
