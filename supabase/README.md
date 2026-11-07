# Avelon Academy portal — backend files

Follow the step-by-step guide "Avelon Academy Portal: Setup Guide" (shared with you as a doc). Summary:

| File | Where it goes |
|---|---|
| `1-schema.sql` | Supabase → SQL Editor → run once |
| `functions/create-card-session/index.ts` | Supabase → Edge Functions → new function `create-card-session` |
| `functions/stripe-webhook/index.ts` | new function `stripe-webhook` |
| `functions/log-session/index.ts` | new function `log-session` |
| `functions/approve-session/index.ts` | new function `approve-session` |
| `functions/weekly-billing/index.ts` | new function `weekly-billing` |
| `2-schedules.sql` | Supabase → SQL Editor → run after the functions are live (replace the 2 placeholders) |

Turn **Verify JWT OFF** on all five functions (each one checks access itself).

Secrets (Edge Functions → Secrets): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_EMAIL`, `SITE_URL`, `CRON_SECRET`.

This folder is reference only; nothing in it runs on GitHub Pages. It contains no secrets.
