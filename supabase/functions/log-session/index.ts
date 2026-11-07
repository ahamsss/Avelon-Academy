// Avelon Academy: a tutor logs a class; the student and parent get a "confirm this class" email.
// Supabase > Edge Functions > name: log-session  (turn "Verify JWT" OFF; this code checks the login itself)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SITE = Deno.env.get("SITE_URL") ?? "https://avelonacademy.ca";

async function sendEmail(to: string[], subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM"), to, subject, html, reply_to: Deno.env.get("ADMIN_EMAIL") }),
  });
  if (!res.ok) console.error("Email failed", await res.text());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await db.auth.getUser(token);
    if (!user) return json({ error: "Please log in again." }, 401);
    const { data: tutor } = await db.from("profiles").select("id, role, full_name").eq("id", user.id).single();
    if (!tutor || tutor.role !== "tutor") return json({ error: "Only tutors can log classes." }, 403);

    const { student_id, class_date, minutes, notes, homework } = await req.json();
    const mins = Number(minutes);
    if (!student_id || !class_date || !(mins >= 15 && mins <= 240)) return json({ error: "Please fill in the student, date and length." }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(class_date)) return json({ error: "Invalid date." }, 400);

    const { data: student } = await db.from("students")
      .select("id, first_name, parent_id, student_email, tutor_id, rate_cents, trial_status, active")
      .eq("id", student_id).single();
    if (!student || student.tutor_id !== tutor.id) return json({ error: "This student isn't assigned to you." }, 403);
    if (!student.active || student.trial_status === "ended") return json({ error: "This student is no longer active." }, 400);

    // How many classes before this one?
    const { count } = await db.from("sessions").select("id", { count: "exact", head: true })
      .eq("student_id", student.id).neq("status", "void");
    const prior = count ?? 0;

    let trial_number: number | null = null;
    if (student.trial_status === "trial") {
      if (prior < 3) trial_number = prior + 1;
      else await db.from("students").update({ trial_status: "continuing" }).eq("id", student.id); // kept going after the trial
    }

    let amount_cents = 0;
    if (trial_number !== 1) {
      if (student.rate_cents == null) return json({ error: "No price is set for this student yet. Ask the admin to set the hourly rate." }, 400);
      amount_cents = Math.round((student.rate_cents * mins) / 60);
    }

    const { data: session, error } = await db.from("sessions").insert({
      student_id: student.id, tutor_id: tutor.id, class_date, minutes: mins,
      notes: notes ? String(notes).slice(0, 2000) : null,
      homework: homework ? String(homework).slice(0, 1000) : null,
      trial_number, amount_cents,
    }).select("id, approve_token").single();
    if (error) throw error;

    // Email the student (if we have their email) and the parent.
    const { data: parent } = await db.from("profiles").select("email").eq("id", student.parent_id).single();
    const to = [parent?.email, student.student_email].filter(Boolean) as string[];
    const link = (a: string) => `${SITE}/approve.html?t=${session.approve_token}&a=${a}`;
    const tutorFirst = (tutor.full_name || "Your tutor").split(" ")[0];
    const trialLine = trial_number ? `<p style="color:#5A5F6E">Trial class ${trial_number} of 3${trial_number === 1 ? " (free)" : ""}.</p>` : "";
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#0B0D12">
        <h2 style="margin:0 0 6px">Please confirm today's class</h2>
        <p>${esc(student.first_name)} had a ${mins}-minute class with ${esc(tutorFirst)} on ${class_date}.</p>
        ${trialLine}
        ${notes ? `<p><b>What we covered:</b><br>${esc(String(notes))}</p>` : ""}
        ${homework ? `<p><b>Homework:</b><br>${esc(String(homework))}</p>` : ""}
        <p style="margin:26px 0">
          <a href="${link("approve")}" style="background:#2563EB;color:#fff;padding:13px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Yes, confirm class</a>
          &nbsp;
          <a href="${link("flag")}" style="color:#1D4ED8">Something's wrong</a>
        </p>
        <p style="color:#5A5F6E;font-size:13px">If we don't hear from you within 24 hours, the class is confirmed automatically.</p>
        <p style="color:#5A5F6E;font-size:13px">Avelon Academy · ${SITE.replace("https://", "")}</p>
      </div>`;
    if (to.length) await sendEmail(to, `Confirm ${student.first_name}'s class on ${class_date}`, html);

    return json({ ok: true, id: session.id });
  } catch (e) {
    console.error(e);
    return json({ error: "Could not save the class. Please try again." }, 500);
  }
});
