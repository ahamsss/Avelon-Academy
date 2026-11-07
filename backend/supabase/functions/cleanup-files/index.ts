// Avelon Academy: daily housekeeping, run by pg_cron.
// 1. Deletes class files older than 90 days (storage + list).
// 2. On Mondays, emails the admin if the database or file storage is past 75% of the free plan.
// Supabase > Edge Functions > name: cleanup-files  (Verify JWT OFF; requires the x-cron-secret header)
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ADMIN = Deno.env.get("ADMIN_EMAIL") ?? "contact@avelonacademy.ca";
const DB_LIMIT = 500 * 1024 * 1024;     // Supabase free plan: 500 MB database
const FILE_LIMIT = 1024 * 1024 * 1024;  // Supabase free plan: 1 GB file storage
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`;

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "Not allowed." }, 401);

  // 1. Old files
  const cutoff = new Date(Date.now() - 90 * 864e5).toISOString();
  let removed = 0;
  for (let round = 0; round < 20; round++) {
    const { data: old, error } = await db.from("class_files").select("id, path").lt("created_at", cutoff).limit(100);
    if (error) { console.error(error); break; }
    if (!old?.length) break;
    const { error: sErr } = await db.storage.from("class-files").remove(old.map((f) => f.path));
    if (sErr) { console.error(sErr); break; }
    await db.from("class_files").delete().in("id", old.map((f) => f.id));
    removed += old.length;
  }

  // 2. Usage check (Mondays only, so it's at most one email a week)
  const { data: u, error: uErr } = await db.rpc("usage_report");
  if (uErr) console.error(uErr);
  const dbPct = u ? Math.round((u.db_bytes / DB_LIMIT) * 100) : 0;
  const filePct = u ? Math.round((u.file_bytes / FILE_LIMIT) * 100) : 0;
  const monday = new Date().getUTCDay() === 1;
  let warned = false;
  if (u && monday && (dbPct >= 75 || filePct >= 75)) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("EMAIL_FROM"), to: [ADMIN],
        subject: `Avelon storage is getting full (database ${dbPct}%, files ${filePct}%)`,
        text: `Heads up: Avelon's Supabase free plan is filling up.\n\nDatabase: ${mb(u.db_bytes)} of 500 MB (${dbPct}%)\nClass files: ${mb(u.file_bytes)} of 1 GB (${filePct}%), ${u.file_count} files\n\nFiles are deleted automatically 90 days after upload. If this keeps climbing, upgrade Supabase to Pro ($25/month: 8 GB database, 100 GB files) at supabase.com > your project > Settings > Billing.`,
      }),
    });
    warned = res.ok;
    if (!res.ok) console.error("Email failed", await res.text());
  }
  return json({ removed, dbPct, filePct, warned });
});
