// Avelon Academy: the "Start with 3 trial classes" form on the homepage.
// Saves the request, emails the parent a welcome note and emails Avelon the details.
// Supabase > Edge Functions > name: book-trial  (Verify JWT OFF: anyone may submit; spam checks are below)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SITE = Deno.env.get("SITE_URL") ?? "https://avelonacademy.ca";
const ADMIN = Deno.env.get("ADMIN_EMAIL") ?? "contact@avelonacademy.ca";

const GRADES = Array.from({ length: 10 }, (_, i) => `Grade ${i + 1}`);
const SUBJECTS = ["Math", "Science", "English", "Bangla", "Not sure yet"];

async function sendEmail(to: string, subject: string, html: string, text: string, replyTo: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM"), to: [to], subject, html, text, reply_to: replyTo }),
  });
  if (!res.ok) { console.error("Email failed", await res.text()); return false; }
  return true;
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- the parent's welcome email ----------
function parentEmail(first: string, grade: string, subject: string) {
  const unsure = subject === "Not sure yet";
  const what = unsure ? "tutoring" : `${subject} tutoring`;
  const tutorLine = unsure
    ? "On the call we'll work out which subject will help most, then match a tutor and set a regular weekly time that works around school."
    : `We match you with a ${subject} tutor and set a regular weekly time that works around school.`;
  const steps = [
    ["A quick call", "Within one day, we'll call or email you to set up a free 15-minute call. We'll talk about the class, any tests coming up and where things feel stuck."],
    ["The right tutor", tutorLine],
    ["Three trial classes", "Start with 3 live online classes. If it isn't the right fit, you walk away and pay nothing. If you'd like to continue, class 1 is free and classes 2 and 3 go on your first weekly bill."],
  ];
  const stepRows = steps.map(([t, d], i) => `
    <tr><td valign="top" style="padding:0 16px 22px 0;width:36px">
      <div style="width:32px;height:32px;border-radius:16px;background:#0E1528;color:#E0B354;font:700 15px/32px Arial,sans-serif;text-align:center">${i + 1}</div></td>
    <td valign="top" style="padding:0 0 22px 0">
      <div style="font-weight:700;font-size:17px;line-height:1.4;font-family:'Inter Tight',Arial,sans-serif;color:#0B0D12;margin:4px 0 4px">${t}</div>
      <div style="font:15px/1.6 Arial,sans-serif;color:#5A5F6E">${esc(d)}</div></td></tr>`).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#F1F1EE">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Here's what happens next. We'll be in touch within one day.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1EE"><tr><td align="center" style="padding:32px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
  <tr><td style="background:#0E1528;border-radius:20px 20px 0 0;padding:34px 36px 30px">
    <a href="${SITE}" style="text-decoration:none"><img src="${SITE}/email-logo.png" width="205" height="35" alt="Avelon Academy" style="display:block;border:0;outline:none;width:205px;height:35px;color:#F3EFE6;font:800 20px Arial,sans-serif"></a>
    <div style="font-weight:700;font-size:34px;line-height:1.1;font-family:'Inter Tight',Arial,sans-serif;color:#FFFFFF;margin-top:28px;letter-spacing:-1px">Welcome to Avelon<span style="color:#E0B354">.</span></div>
    <div style="font:16px/1.5 Arial,sans-serif;color:#C3CBDD;margin-top:10px">Your request for trial classes is in.</div>
  </td></tr>
  <tr><td style="background:#FFFFFF;padding:34px 36px 8px">
    <p style="font:16px/1.65 Arial,sans-serif;color:#0B0D12;margin:0 0 16px">Hi ${esc(first)},</p>
    <p style="font:16px/1.65 Arial,sans-serif;color:#0B0D12;margin:0 0 16px">Thank you for reaching out about ${esc(what)} for ${esc(grade)}. Every student learns differently, and we're glad you're giving us the chance to help.</p>
    <p style="font:16px/1.65 Arial,sans-serif;color:#0B0D12;margin:0 0 26px">Here's what happens next:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${stepRows}</table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1EE;border-radius:14px;margin:4px 0 26px"><tr><td style="padding:18px 22px">
      <div style="font:700 12px Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:#1D4ED8;margin-bottom:10px">Your request</div>
      <div style="font:15px/1.7 Arial,sans-serif;color:#0B0D12">Grade: <b>${esc(grade)}</b><br>Subject: <b>${esc(subject)}</b></div>
    </td></tr></table>
    <p style="font:16px/1.65 Arial,sans-serif;color:#0B0D12;margin:0 0 16px">If there's anything you'd like us to know before we talk, like a test coming up, a topic that feels hard or the times that suit your family, just reply to this email. It comes straight to us.</p>
    <p style="font:16px/1.65 Arial,sans-serif;color:#0B0D12;margin:0 0 30px">We're looking forward to getting started.</p>
    <p style="font:16px/1.5 Arial,sans-serif;color:#0B0D12;margin:0 0 34px">Warmly,<br><b>Sadman</b><br><span style="color:#5A5F6E">Founder, Avelon Academy</span></p>
  </td></tr>
  <tr><td style="background:#0E1528;border-radius:0 0 20px 20px;padding:24px 36px">
    <div style="font:14px/1.6 Arial,sans-serif;color:#A3ACBF">Online tutoring across Canada, Grades 1&ndash;10<br>
      <a href="${SITE}" style="color:#F3EFE6;text-decoration:none">avelonacademy.ca</a> &nbsp;&middot;&nbsp; <a href="mailto:${ADMIN}" style="color:#F3EFE6;text-decoration:none">${ADMIN}</a></div>
  </td></tr>
  <tr><td style="padding:18px 36px 0;font:12px/1.6 Arial,sans-serif;color:#8A8F9C;text-align:center">
    You're receiving this because someone requested trial classes at avelonacademy.ca with this email address. If that wasn't you, you can ignore this message.
  </td></tr>
</table></td></tr></table></body></html>`;

  const text = `Hi ${first},

Thank you for reaching out about ${what} for ${grade}. Every student learns differently, and we're glad you're giving us the chance to help.

Here's what happens next:

1. A quick call
${steps[0][1]}

2. The right tutor
${steps[1][1]}

3. Three trial classes
${steps[2][1]}

Your request: ${grade} · ${subject}

If there's anything you'd like us to know before we talk, like a test coming up, a topic that feels hard or the times that suit your family, just reply to this email. It comes straight to us.

We're looking forward to getting started.

Warmly,
Sadman
Founder, Avelon Academy
${SITE}`;
  return { html, text };
}

// ---------- the note to Avelon ----------
function adminEmail(r: { parent_name: string; email: string; phone: string; grade: string; subject: string }) {
  const row = (k: string, v: string) => `<tr><td style="padding:6px 18px 6px 0;color:#5A5F6E">${k}</td><td style="padding:6px 0"><b>${v}</b></td></tr>`;
  const html = `<div style="font:15px/1.5 Arial,sans-serif;color:#0B0D12;max-width:520px">
    <p style="font-size:18px;margin:0 0 14px"><b>New trial request</b></p>
    <table cellpadding="0" cellspacing="0">${row("Parent/student", esc(r.parent_name))}${row("Email", `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>`)}${row("Phone", `<a href="tel:${esc(r.phone.replace(/[^\d+]/g, ""))}">${esc(r.phone)}</a>`)}${row("Grade", esc(r.grade))}${row("Subject", esc(r.subject))}</table>
    <p style="margin:18px 0 0;color:#5A5F6E">They've been sent the welcome email. Hit Reply to answer them directly, or see all requests in the <a href="${SITE}/portal/">portal</a>.</p></div>`;
  const text = `New trial request\nParent/student: ${r.parent_name}\nEmail: ${r.email}\nPhone: ${r.phone}\nGrade: ${r.grade}\nSubject: ${r.subject}\n\nReply to this email to answer them directly.`;
  return { html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Not allowed." }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    // Spam traps: a hidden field people never fill in, and forms sent faster than a person could type.
    if (b.company || (Number(b.elapsed) > 0 && Number(b.elapsed) < 2500)) return json({ ok: true });

    const parent_name = String(b.parent ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
    const email = String(b.email ?? "").trim().toLowerCase().slice(0, 254);
    const phone = String(b.phone ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
    const grade = String(b.grade ?? "");
    const subject = String(b.subject ?? "");
    if (!parent_name) return json({ error: "Please enter your name." }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: "Please enter a valid email address." }, 400);
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15 || /[^\d\s()+.\-]/.test(phone)) return json({ error: "Please enter a phone number we can call, with area code." }, 400);
    if (!GRADES.includes(grade)) return json({ error: "Please choose a grade." }, 400);
    if (!SUBJECTS.includes(subject)) return json({ error: "Please choose a subject." }, 400);

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
    const ip_hash = ip ? await sha256(ip + (Deno.env.get("CRON_SECRET") ?? "avelon")) : null;
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();

    // Same email in the last 10 minutes: treat as a double-click, don't email twice.
    const { count: dup } = await db.from("trial_requests").select("id", { count: "exact", head: true })
      .eq("email", email).gte("created_at", new Date(Date.now() - 600_000).toISOString());
    if (dup) return json({ ok: true });
    if (ip_hash) {
      const { count } = await db.from("trial_requests").select("id", { count: "exact", head: true })
        .eq("ip_hash", ip_hash).gte("created_at", hourAgo);
      if ((count ?? 0) >= 5) return json({ error: "Too many requests. Please email us at " + ADMIN + "." }, 429);
    }

    const row = { parent_name, email, phone, grade, subject, ip_hash };
    const { error } = await db.from("trial_requests").insert(row);
    if (error) { console.error(error); return json({ error: "Something went wrong. Please email us at " + ADMIN + "." }, 500); }

    const first = parent_name.split(" ")[0];
    const p = parentEmail(first, grade, subject);
    const a = adminEmail(row);
    await Promise.all([
      sendEmail(email, "Welcome to Avelon Academy: your trial classes", p.html, p.text, ADMIN),
      sendEmail(ADMIN, `New trial request: ${parent_name} · ${grade} · ${subject}`, a.html, a.text, email),
    ]);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please email us at " + ADMIN + "." }, 500);
  }
});
