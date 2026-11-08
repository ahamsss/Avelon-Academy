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
const GRADES = Array.from({ length: 10 }, (_, i) => `Grade ${i + 1}`);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM"), to: [to], subject, html, text, reply_to: ADMIN }),
  });
  if (!res.ok) console.error("Email failed", await res.text());
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A 6-digit sign-in code for this email, valid 24 hours, single use. Replaces any unused older code.
async function makeCode(email: string) {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const code = String(n).padStart(6, "0");
  const pepper = Deno.env.get("CRON_SECRET") ?? "avelon";
  await db.from("invite_codes").delete().eq("email", email).is("used_at", null);
  const { error } = await db.from("invite_codes").insert({ email, code_hash: await sha256(`${email}:${code}:${pepper}`), expires_at: new Date(Date.now() + 24 * 3600_000).toISOString() });
  if (error) throw new Error("Couldn't save the sign-in code: " + error.message);
  return code;
}

function inviteEmail(first: string, kind: "tutor" | "family" | "student", email: string, code: string, student?: string, resend = false) {
  const title = resend ? "Your sign-in code" : kind === "tutor" ? "Welcome to the team" : "Your account is ready";
  const lines = resend
    ? ["Here's a new code to sign in to your Avelon account."]
    : kind === "tutor"
    ? ["You're now set up as an Avelon tutor. Once you log in, you'll see the students you're matched with, their weekly class times and Google Meet links, and the place to log each class right after it ends."]
    : kind === "student"
    ? ["Your parent or guardian set up your Avelon account. Once you log in, you'll see your class times and Google Meet links, plus your notes, homework and files."]
    : [`Your Avelon account${student ? " for " + esc(student) : ""} is ready. Once you log in, you'll see class times and Google Meet links, confirm classes, read notes and homework, and manage payments.`];
  const how = "Press <b>Log in</b> below and type in the code above. Or go to avelonacademy.ca, click <b>Log in</b> at the top right, then <b>I have a code</b>. There's no password to remember.";
  const codeBox = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1EE;border-radius:14px;margin:4px 0 22px"><tr><td style="padding:20px 22px;text-align:center">
      <div style="font:700 12px Arial,sans-serif;letter-spacing:1.5px;text-transform:uppercase;color:#1D4ED8;margin-bottom:8px">Your sign-in code</div>
      <div style="font:700 34px/1.2 'Courier New',monospace;letter-spacing:6px;color:#0B0D12">${code}</div>
      <div style="font:13px/1.5 Arial,sans-serif;color:#5A5F6E;margin-top:8px">Works once, for the next 24 hours. After that, use "Email me a sign-in code" on the login page.</div></td></tr></table>`;
  const loginUrl = `${SITE}/portal/?code=1&email=${encodeURIComponent(email)}`;
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
    ${p(`Hi ${esc(first || "there")},`)}${lines.map(p).join("")}${codeBox}${p(how)}
    <p style="margin:8px 0 30px"><a href="${loginUrl}" style="background:#0E1528;color:#FFFFFF;padding:14px 26px;border-radius:999px;text-decoration:none;font:700 15px Arial,sans-serif;display:inline-block">Log in</a></p>
    ${p("Questions? Just reply to this email.")}
    <p style="font:16px/1.5 Arial,sans-serif;color:#0B0D12;margin:0 0 34px">Warmly,<br><b>Sadman</b><br><span style="color:#5A5F6E">Founder, Avelon Academy</span></p>
  </td></tr>
  <tr><td style="background:#0E1528;border-radius:0 0 20px 20px;padding:24px 36px">
    <div style="font:14px/1.6 Arial,sans-serif;color:#A3ACBF"><a href="${SITE}" style="color:#F3EFE6;text-decoration:none">avelonacademy.ca</a> &nbsp;&middot;&nbsp; <a href="mailto:${ADMIN}" style="color:#F3EFE6;text-decoration:none">${ADMIN}</a></div>
  </td></tr>
</table></td></tr></table></body></html>`;
  const text = `Hi ${first || "there"},\n\n${lines.join("\n\n").replace(/&#39;/g, "'").replace(/&amp;/g, "&")}\n\nYour sign-in code: ${code} (works once, for 24 hours)\n\n${how.replace(/<\/?b>/g, "")}\n\nLog in: ${loginUrl}\n\nQuestions? Just reply to this email.\n\nWarmly,\nSadman\nFounder, Avelon Academy`;
  return { html, text, subject: kind === "tutor" ? "Welcome to Avelon Academy: your tutor account" : kind === "student" ? "Your Avelon Academy student account is ready" : "Your Avelon Academy account is ready" };
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

    // Resend a 24-hour sign-in code to someone already set up (family, tutor or student email).
    if (b.kind === "resend") {
      const em = String(b.email ?? "").trim().toLowerCase();
      if (!EMAIL_RE.test(em)) return json({ error: "Please enter a valid email." }, 400);
      const { data: pr } = await db.from("profiles").select("role, full_name").eq("email", em).maybeSingle();
      const { data: stu } = await db.from("students").select("first_name").eq("student_email", em).limit(1).maybeSingle();
      if (!pr && !stu) return json({ error: "No one with that email is set up yet." }, 404);
      const k: "tutor" | "family" | "student" = pr?.role === "tutor" ? "tutor" : (!pr || pr.role === "parent") && stu ? "student" : "family";
      const first = (k === "student" ? stu?.first_name : pr?.full_name?.split(" ")[0]) || "";
      const m = inviteEmail(first, k, em, await makeCode(em), undefined, true);
      await sendEmail(em, "Your Avelon Academy sign-in code", m.html, m.text);
      return json({ ok: true });
    }

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
      const m = inviteEmail(full_name.split(" ")[0], kind, email, await makeCode(email), st?.first_name);
      await sendEmail(email, m.subject, m.html, m.text);
      if (kind === "family" && st.student_email && st.student_email !== email) {
        const sm = inviteEmail(st.first_name, "student", st.student_email, await makeCode(st.student_email));
        await sendEmail(st.student_email, sm.subject, sm.html, sm.text);
      }
    }
    return json({ ok: true, created });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error)?.message?.startsWith("Couldn't") ? (e as Error).message : "Something went wrong. Please try again." }, 500);
  }
});
