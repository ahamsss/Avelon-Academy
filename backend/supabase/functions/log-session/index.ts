// Avelon Academy: a tutor logs a class; the parent gets a short "class logged" email.
// Nothing to confirm: the class is billed automatically after 48 hours unless the parent reports a problem first.
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

    const { student_id, class_date, minutes, notes, homework, next_plan } = await req.json();
    let mins = Number(minutes);
    if (!student_id || !class_date || !(mins >= 15 && mins <= 240)) return json({ error: "Please fill in the student, date and length." }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(class_date)) return json({ error: "Invalid date." }, 400);

    const { data: student } = await db.from("students")
      .select("id, first_name, grade, subject, parent_id, student_email, tutor_id, rate_cents, trial_status, active")
      .eq("id", student_id).single();
    if (!student || student.tutor_id !== tutor.id) return json({ error: "This student isn't assigned to you." }, 403);
    if (!student.active || student.trial_status === "ended") return json({ error: "This student is no longer active." }, 400);

    // Classes are charged at the booked length, never the actual time (no overtime charges).
    // Use the weekly slot on that weekday; if none that day, the student's first slot; if no slots, what the tutor picked.
    const { data: slots } = await db.from("class_slots").select("weekday, minutes").eq("student_id", student.id).order("created_at");
    if (slots && slots.length) {
      const wd = new Date(class_date + "T12:00:00Z").getUTCDay();
      mins = (slots.find((x) => x.weekday === wd) ?? slots[0]).minutes;
    }

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
      next_plan: next_plan ? String(next_plan).slice(0, 1000) : null,
      trial_number, amount_cents,
    }).select("id, approve_token").single();
    if (error) throw error;

    // Email the parent (the account holder). Students see their notes in My Avelon and the weekend report.
    const { data: parent } = await db.from("profiles").select("email, full_name").eq("id", student.parent_id).single();
    const reportLink = `${SITE}/approve.html?t=${session.approve_token}&a=flag`;
    const tutorFirst = (tutor.full_name || "Your tutor").split(" ")[0];
    // Grades 1-5: the parent sees the class notes. Grade 6+ with their own login: notes stay with the student.
    const gradeNum = parseInt(String((student as any).grade ?? "").replace(/\D/g, ""), 10);
    const teen = gradeNum >= 6 && !!student.student_email;
    const fee = trial_number === 1 ? "Free (trial class 1 of 3)" : trial_number ? `Trial class ${trial_number} of 3` : "";
    const p = (t: string) => `<p style="font:15px/1.6 Arial,sans-serif;color:#0B0D12;margin:0 0 14px">${t}</p>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#F1F1EE"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1EE"><tr><td align="center" style="padding:32px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
  <tr><td style="background:#0E1528;border-radius:20px 20px 0 0;padding:30px 36px 26px">
    <img src="${SITE}/email-logo.png" width="205" height="35" alt="Avelon Academy" style="display:block;border:0;width:205px;height:35px;color:#F3EFE6;font:800 20px Arial,sans-serif">
    <div style="font:700 26px/1.2 Arial,sans-serif;color:#FFFFFF;margin-top:24px">Class logged<span style="color:#E0B354">.</span></div>
    <div style="font:15px/1.5 Arial,sans-serif;color:#C3CBDD;margin-top:6px">${esc(student.first_name)}${(student as any).subject ? " &middot; " + esc((student as any).subject) : ""} &middot; ${esc(class_date)} &middot; ${mins} min with ${esc(tutorFirst)}</div>
  </td></tr>
  <tr><td style="background:#FFFFFF;padding:28px 36px 10px">
    ${fee ? p(`<b>${fee}</b>`) : ""}
    ${!teen && notes ? p(`<b>What we covered:</b><br>${esc(String(notes)).replace(/\n/g, "<br>")}`) : ""}
    ${!teen && homework ? p(`<b>Homework:</b><br>${esc(String(homework)).replace(/\n/g, "<br>")}`) : ""}
    ${teen ? p(`${esc(student.first_name)} can see the class notes and homework in My Avelon.`) : ""}
    ${p("Nothing to do. If something isn't right, report it within 48 hours and we won't charge this class until it's sorted. After 48 hours it's billed on your next Monday payment.")}
    <p style="margin:6px 0 26px"><a href="${reportLink}" style="color:#1D4ED8;font:700 15px Arial,sans-serif">Report a problem with this class</a></p>
  </td></tr>
  <tr><td style="background:#0E1528;border-radius:0 0 20px 20px;padding:20px 36px"><div style="font:14px/1.6 Arial,sans-serif;color:#A3ACBF">All classes and notes: <a href="${SITE}/portal/" style="color:#F3EFE6">log in at ${SITE.replace("https://", "")}</a></div></td></tr>
</table></td></tr></table></body></html>`;
    if (parent?.email) await sendEmail([parent.email], `${student.first_name}'s class on ${class_date} is logged`, html);

    return json({ ok: true, id: session.id });
  } catch (e) {
    console.error(e);
    return json({ error: "Could not save the class. Please try again." }, 500);
  }
});
