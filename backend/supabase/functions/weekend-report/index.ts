// Avelon Academy: the weekend report.
// Every Saturday (pg_cron), each student with classes in the past 7 days gets ONE email to the email on file
// (the student's own email if the parent added it, otherwise the parent's), listing what was covered and what to practise.
// A student taking several subjects gets one email with a section per subject.
// Admins can also call it from the portal: {"preview": true} sends every report to the admin only, without marking them sent.
// Supabase > Edge Functions > name: weekend-report  (Verify JWT OFF; checks the cron secret or an admin login)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const nl = (s: string) => esc(s).replace(/\n/g, "<br>");

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SITE = Deno.env.get("SITE_URL") ?? "https://avelonacademy.ca";
const ADMIN = Deno.env.get("ADMIN_EMAIL") ?? "contact@avelonacademy.ca";

// Today's date in Edmonton, as YYYY-MM-DD
const localDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton" }).format(d);
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pretty = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-CA", { timeZone: "UTC", ...opts });

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM"), to: [to], subject, html, text, reply_to: ADMIN }),
  });
  if (!res.ok) { console.error("Email failed", await res.text()); return false; }
  return true;
}

async function allowed(req: Request) {
  const secret = Deno.env.get("CRON_SECRET");
  if (secret && req.headers.get("x-cron-secret") === secret) return true;
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data: p } = await db.from("profiles").select("role").eq("id", user.id).single();
  return p?.role === "admin";
}

type Cls = { class_date: string; minutes: number; notes: string | null; homework: string | null; next_plan: string | null; tutor_id: string };

type Part = { subject: string; tutorName: string; classes: Cls[] };
const joinNames = (xs: string[]) => xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " & " + xs[xs.length - 1];

// One email per student. A student taking several subjects gets one section per subject.
function reportEmail(first: string, grade: string, parts: Part[], weekLabel: string) {
  const all = parts.flatMap((p) => p.classes);
  const totalMin = all.reduce((a, c) => a + c.minutes, 0);
  const multi = parts.length > 1;
  const subjects = joinNames(parts.map((p) => p.subject).filter(Boolean));
  const tutors = [...new Set(parts.map((p) => p.tutorName).filter(Boolean))];
  const label = (t: string, mt = 0) => `<div style="font:700 12px Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:#1D4ED8;margin:${mt}px 0 4px">${t}</div>`;
  const box = (t: string, inner: string, mb = 16) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1EE;border-radius:14px;margin:6px 0 ${mb}px"><tr><td style="padding:18px 22px">
        <div style="font:700 12px Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:#1D4ED8;margin-bottom:10px">${t}</div>${inner}</td></tr></table>`;

  const section = (p: Part) => {
    const hw = p.classes.map((c) => (c.homework || "").trim()).filter(Boolean);
    const plan = [...p.classes].reverse().map((c) => (c.next_plan || "").trim()).find(Boolean) || "";
    const rows = p.classes.map((c) => `
    <tr><td style="padding:16px 0;border-top:1px solid #E2E2DD">
      <div style="font:700 15px Arial,sans-serif;color:#0B0D12">${esc(pretty(c.class_date, { weekday: "long", month: "short", day: "numeric" }))}
        <span style="font-weight:400;color:#5A5F6E">&nbsp;&middot;&nbsp;${c.minutes} min</span></div>
      ${c.notes ? `<div style="font:15px/1.6 Arial,sans-serif;color:#0B0D12;margin-top:6px">${nl(c.notes)}</div>` : ""}
    </td></tr>`).join("");
    const head = multi
      ? `<div style="font:700 22px/1.2 Arial,sans-serif;color:#0B0D12;margin:0 0 2px">${esc(p.subject)}</div>
         <div style="font:14px Arial,sans-serif;color:#5A5F6E;margin:0 0 14px">${p.tutorName ? "with " + esc(p.tutorName) + " &middot; " : ""}${p.classes.length} class${p.classes.length === 1 ? "" : "es"}</div>` : "";
    return `${head}${label("What we covered")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px">${rows}</table>
    ${hw.length ? box("To practise next", hw.map((h) => `<div style="font:15px/1.6 Arial,sans-serif;color:#0B0D12;margin:0 0 6px">&bull;&nbsp; ${nl(h)}</div>`).join("")) : ""}
    ${plan ? box("Next week", `<div style="font:15px/1.6 Arial,sans-serif;color:#0B0D12">${nl(plan)}</div>`) : ""}`;
  };
  const body = parts.map(section).join(`<div style="height:1px;background:#E2E2DD;margin:16px 0 26px"></div>`);
  const who = tutors.length ? joinNames(tutors) : "your tutor";

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:#F1F1EE">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(first)}'s week: ${all.length} class${all.length === 1 ? "" : "es"}, ${totalMin} minutes of ${esc(subjects || "tutoring")}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1EE"><tr><td align="center" style="padding:32px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
  <tr><td style="background:#0E1528;border-radius:20px 20px 0 0;padding:30px 36px 28px">
    <img src="${SITE}/email-logo.png" width="205" height="35" alt="Avelon Academy" style="display:block;border:0;width:205px;height:35px;color:#F3EFE6;font:800 20px Arial,sans-serif">
    <div style="font:700 12px Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:#93C5FD;margin-top:26px">Weekend report &middot; ${esc(weekLabel)}</div>
    <div style="font:700 30px/1.15 Arial,sans-serif;color:#FFFFFF;margin-top:8px;letter-spacing:-.5px">${esc(first)}'s week<span style="color:#E0B354">.</span></div>
    <div style="font:15px/1.5 Arial,sans-serif;color:#C3CBDD;margin-top:8px">${esc([grade, subjects].filter(Boolean).join(" · "))} &middot; ${all.length} class${all.length === 1 ? "" : "es"}, ${totalMin} minutes</div>
  </td></tr>
  <tr><td style="background:#FFFFFF;padding:28px 36px 8px">
    ${body}
    <p style="font:15px/1.65 Arial,sans-serif;color:#0B0D12;margin:10px 0 16px">Questions, or something you'd like ${esc(who)} to focus on next week? Just reply to this email.</p>
    <p style="font:15px/1.5 Arial,sans-serif;color:#0B0D12;margin:0 0 30px">Have a great weekend,<br><b>Avelon Academy</b></p>
  </td></tr>
  <tr><td style="background:#0E1528;border-radius:0 0 20px 20px;padding:22px 36px">
    <div style="font:14px/1.6 Arial,sans-serif;color:#A3ACBF">Class times, Meet links and files: <a href="${SITE}/portal/" style="color:#F3EFE6">log in at ${SITE.replace("https://", "")}</a></div>
  </td></tr>
</table></td></tr></table></body></html>`;

  const textPart = (p: Part) => {
    const hw = p.classes.map((c) => (c.homework || "").trim()).filter(Boolean);
    const plan = [...p.classes].reverse().map((c) => (c.next_plan || "").trim()).find(Boolean) || "";
    return `${multi ? `== ${p.subject.toUpperCase()}${p.tutorName ? " (with " + p.tutorName + ")" : ""} ==\n` : ""}WHAT WE COVERED
${p.classes.map((c) => `${pretty(c.class_date, { weekday: "long", month: "short", day: "numeric" })} · ${c.minutes} min\n${c.notes || ""}`).join("\n\n")}
${hw.length ? `\nTO PRACTISE NEXT\n${hw.map((h) => "- " + h).join("\n")}\n` : ""}${plan ? `\nNEXT WEEK\n${plan}\n` : ""}`;
  };
  const text = `${first}'s week (${weekLabel})
${[grade, subjects].filter(Boolean).join(" · ")} · ${all.length} class(es), ${totalMin} minutes

${parts.map(textPart).join("\n")}
Questions? Just reply to this email.

Avelon Academy
${SITE}/portal`;
  return { html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await allowed(req))) return json({ error: "Not allowed." }, 401);
  const body = await req.json().catch(() => ({}));
  const preview = !!body.preview;

  // The week = the 7 days ending yesterday (run on Saturday: last Saturday to Friday).
  const today = localDate();
  const from = addDays(today, -7), to = addDays(today, -1);
  const weekLabel = `${pretty(from, { month: "short", day: "numeric" })}–${pretty(to, { month: "short", day: "numeric" })}`;

  const { data: sessions, error } = await db.from("sessions")
    .select("student_id, tutor_id, class_date, minutes, notes, homework, next_plan, status")
    .gte("class_date", from).lte("class_date", to).neq("status", "void").order("class_date");
  if (error) return json({ error: error.message }, 500);

  const byStudent = new Map<string, Cls[]>();
  for (const s of sessions ?? []) { if (!byStudent.has(s.student_id)) byStudent.set(s.student_id, []); byStudent.get(s.student_id)!.push(s as Cls); }
  if (!byStudent.size) return json({ sent: 0, skipped: 0, note: "No classes this week." });

  const ids = [...byStudent.keys()];
  const [{ data: kids }, { data: done }] = await Promise.all([
    db.from("students").select("id, first_name, grade, subject, student_email, parent_id, active").in("id", ids),
    db.from("weekend_reports").select("student_id").eq("week_start", from).in("student_id", ids),
  ]);
  const already = new Set((done ?? []).map((d) => d.student_id));
  const people = new Set<string>();
  for (const k of kids ?? []) people.add(k.parent_id);
  for (const list of byStudent.values()) for (const c of list) people.add(c.tutor_id);
  const { data: profs } = await db.from("profiles").select("id, email, full_name").in("id", [...people]);
  const P = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));

  const result = { sent: [] as string[], skipped: [] as string[], failed: [] as string[], preview };
  // Group subject rows that belong to the same student (same family, same first name, same inbox).
  const groups = new Map<string, any[]>();
  for (const k of kids ?? []) {
    if (!k.active) { result.skipped.push(`${k.first_name} ${k.subject || ""} (inactive)`); continue; }
    if (!preview && already.has(k.id)) { result.skipped.push(`${k.first_name} ${k.subject || ""} (already sent)`); continue; }
    const to_ = k.student_email || P[k.parent_id]?.email;
    if (!to_) { result.skipped.push(`${k.first_name} (no email)`); continue; }
    const key = `${k.parent_id}|${k.first_name.trim().toLowerCase()}|${to_.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ ...k, to_ });
  }
  for (const rows of groups.values()) {
    const k = rows[0], to_ = k.to_;
    const parts: Part[] = rows.map((r) => {
      const classes = byStudent.get(r.id)!;
      return { subject: r.subject || "", tutorName: P[classes[classes.length - 1].tutor_id]?.full_name?.split(" ")[0] || "", classes };
    });
    const grade = rows.find((r) => r.grade)?.grade || "";
    const { html, text } = reportEmail(k.first_name, grade, parts, weekLabel);
    const subject = `${preview ? "[Preview for " + to_ + "] " : ""}${k.first_name}'s weekend report: ${weekLabel}`;
    const ok = await sendEmail(preview ? ADMIN : to_, subject, html, text);
    if (!ok) { result.failed.push(k.first_name); continue; }
    result.sent.push(`${k.first_name}${rows.length > 1 ? " (" + joinNames(rows.map((r) => r.subject)) + ")" : ""} → ${preview ? ADMIN + " (preview)" : to_}`);
    if (!preview) for (const r of rows) await db.from("weekend_reports").insert({ student_id: r.id, week_start: from, sent_to: to_, class_count: byStudent.get(r.id)!.length });
  }
  return json(result);
});
