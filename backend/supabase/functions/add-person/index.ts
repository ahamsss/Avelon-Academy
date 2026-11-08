// Avelon Academy: admin adds a tutor or a family (with their first student) and emails them that their account is ready.
// Supabase > Edge Functions > name: add-person  (Verify JWT OFF; this code checks the admin login itself)
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
const GRADES = Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM"), to: [to], subject, html, text, reply_to: ADMIN }),
  });
  if (!res.ok) console.error("Email failed", await res.text());
}

function inviteEmail(first: string, kind: "tutor" | "family", student?: string) {
  const title = kind === "tutor" ? "Welcome to the team" : "Your account is ready";
  const lines = kind === "tutor"
    ? ["You're now set up as an Avelon tutor. Once you log in, you'll see the students you're matched with, their weekly class times and Google Meet links, and the place to log each class right after it ends."]
    : [`Your Avelon account${student ? " for " + esc(student) : ""} is ready. Once you log in, you'll see class times and Google Meet links, confirm classes, read notes and homework, and manage payments.`];
  const how = "To sign in, go to avelonacademy.ca and click <b>Log in</b> at the top right (or use the button below). Enter this email address and we'll send you a sign-in link. There's no password to remember.";
  const p = (t: string) => `<p style="font:16px/1.65 Arial,sans-serif;color:#0B0D12;margin:0 0 16px">${t}</p>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:#F1F1EE">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1EE"><tr><td align="center" style="padding:32px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
  <tr><td style="background:#0E1528;border-radius:20px 20px 0 0;padding:34px 36px 30px">
    <a href="${SITE}" style="text-decoration:none"><img src="${SITE}/email-logo.png" width="205" height="35" alt="Avelon Academy" style="display:block;border:0;width:205px;height:35px;color:#F3EFE6;font:800 20px Arial,sans-serif"></a>
    <div style="font:700 34px/1.1 Arial,sans-serif;color:#FFFFFF;margin-top:28px;letter-spacing:-1px">${title}<span style="color:#E0B354">.</span></div>
  </td></tr>
  <tr><td style="background:#FFFFFF;padding:34px 36px 8px">
    ${p(`Hi ${esc(first || "there")},`)}${lines.map(p).join("")}${p(how)}
    <p style="margin:8px 0 30px"><a href="${SITE}/portal/" style="background:#0E1528;color:#FFFFFF;padding:14px 26px;border-radius:999px;text-decoration:none;font:700 15px Arial,sans-serif;display:inline-block">Log in</a></p>
    ${p("Questions? Just reply to this email.")}
    <p style="font:16px/1.5 Arial,sans-serif;color:#0B0D12;margin:0 0 34px">Warmly,<br><b>Sadman</b><br><span style="color:#5A5F6E">Founder, Avelon Academy</span></p>
  </td></tr>
  <tr><td style="background:#0E1528;border-radius:0 0 20px 20px;padding:24px 36px">
    <div style="font:14px/1.6 Arial,sans-serif;color:#A3ACBF"><a href="${SITE}" style="color:#F3EFE6;text-decoration:none">avelonacademy.ca</a> &nbsp;&middot;&nbsp; <a href="mailto:${ADMIN}" style="color:#F3EFE6;text-decoration:none">${ADMIN}</a></div>
  </td></tr>
</table></td></tr></table></body></html>`;
  const text = `Hi ${first || "there"},\n\n${lines.join("\n\n").replace(/&#39;/g, "'").replace(/&amp;/g, "&")}\n\n${how.replace(/<\/?b>/g, "")}\n\nLog in: ${SITE}/portal/\n\nQuestions? Just reply to this email.\n\nWarmly,\nSadman\nFounder, Avelon Academy`;
  return { html, text, subject: kind === "tutor" ? "Welcome to Avelon Academy: your tutor account" : "Your Avelon Academy account is ready" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await db.auth.getUser(token);
    if (!user) return json({ error: "Please log in again." }, 401);
    const { data: me } = await db.from("profiles").select("role").eq("id", user.id).single();
    if (me?.role !== "admin") return json({ error: "Admins only." }, 403);

    const b = await req.json();
    const kind = b.kind === "tutor" ? "tutor" : b.kind === "family" ? "family" : null;
    const email = String(b.email ?? "").trim().toLowerCase();
    const full_name = String(b.full_name ?? "").trim().slice(0, 100);
    const phone = String(b.phone ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
    if (!kind) return json({ error: "Unknown type." }, 400);
    if (!EMAIL_RE.test(email) || email.length > 200) return json({ error: "Please enter a valid email." }, 400);
    if (!full_name) return json({ error: "Please enter a name." }, 400);

    let st: any = null;
    if (kind === "family") {
      st = {
        first_name: String(b.student_first_name ?? "").trim().slice(0, 60),
        grade: String(b.grade ?? ""), subject: String(b.subject ?? "").trim().slice(0, 40),
        student_email: String(b.student_email ?? "").trim().toLowerCase() || null,
        tutor_id: b.tutor_id || null,
        rate_cents: b.rate === "" || b.rate == null ? null : Math.round(Number(b.rate) * 100),
      };
      if (!st.first_name) return json({ error: "Please enter the student's first name." }, 400);
      if (!GRADES.includes(st.grade)) return json({ error: "Please pick a grade." }, 400);
      if (!st.subject) return json({ error: "Please pick a subject." }, 400);
      if (st.student_email && !EMAIL_RE.test(st.student_email)) return json({ error: "The student's email doesn't look right." }, 400);
      if (st.rate_cents != null && !(st.rate_cents >= 0 && st.rate_cents <= 50000)) return json({ error: "Rate should be between $0 and $500." }, 400);
      if (st.tutor_id) {
        const { data: t } = await db.from("profiles").select("role").eq("id", st.tutor_id).single();
        if (!t || t.role !== "tutor") return json({ error: "That tutor wasn't found." }, 400);
      }
    }

    // Find or create the account.
    let { data: prof } = await db.from("profiles").select("id, role, full_name").eq("email", email).maybeSingle();
    let created = false;
    if (!prof) {
      const { data: nu, error } = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name } });
      if (error || !nu?.user) return json({ error: error?.message ?? "Couldn't create the account." }, 400);
      created = true;
      prof = { id: nu.user.id, role: "parent", full_name };
    }
    if (prof.role === "admin" && kind === "tutor") { /* admin can also tutor; keep admin */ }
    else if (kind === "tutor" && prof.role !== "tutor") await db.from("profiles").update({ role: "tutor" }).eq("id", prof.id);
    if (!prof.full_name) await db.from("profiles").update({ full_name }).eq("id", prof.id);
    if (phone) await db.from("profiles").update({ phone }).eq("id", prof.id);

    if (kind === "family") {
      const { error } = await db.from("students").insert({ parent_id: prof.id, ...st });
      if (error) return json({ error: error.message }, 400);
      if (b.request_id) await db.from("trial_requests").update({ status: "booked" }).eq("id", b.request_id);
    }

    if (b.send_email !== false) {
      const m = inviteEmail(full_name.split(" ")[0], kind, st?.first_name);
      await sendEmail(email, m.subject, m.html, m.text);
    }
    return json({ ok: true, created });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
