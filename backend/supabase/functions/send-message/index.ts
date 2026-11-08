// Avelon Academy: post a message in a student's thread and email the others in it.
// Who can post: the student's parent, the student (their own login), their tutor, and admins.
// Everyone in the thread sees every message, and admins see all threads.
// Messages with a phone number, email address or outside link (other than Meet, YouTube, Khan Academy) are flagged for the admin to review.
// Supabase > Edge Functions > name: send-message  (Verify JWT OFF; this code checks the login itself)
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
const QUIET_MIN = 30; // at most one alert email per person per thread every 30 minutes

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM"), to: [to], subject, html, text, reply_to: ADMIN }),
  });
  if (!res.ok) console.error("Email failed", await res.text());
}

// Phone numbers, email addresses, outside links, or asking to move to WhatsApp and similar apps.
function looksLikeContact(s: string) {
  const t = s.toLowerCase();
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(t)) return true;
  if ((t.match(/\+?\d[\d\s().-]{7,}\d/g) || []).some((m) => m.replace(/\D/g, "").length >= 9 && !/^\d{4}-\d{2}-\d{2}$/.test(m.trim()))) return true;
  if (/\b(whats\s?app|telegram|viber|instagram|insta|snapchat|facebook|messenger|discord|wechat|tiktok)\b/.test(t)) return true;
  const links = t.match(/(https?:\/\/|www\.)[^\s]+/g) || [];
  // Learning links are fine: Google Meet, YouTube and Khan Academy. Anything else is flagged for review.
  return links.some((l) => !/^(https?:\/\/)?((www\.|m\.)?(meet\.google\.com|youtube\.com|youtu\.be|khanacademy\.org|avelonacademy\.ca))(\/|$)/.test(l));
}

function alertEmail(first: string, from: string, about: string, body: string, flaggedNote = "") {
  const url = `${SITE}/portal/`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#F1F1EE"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1EE"><tr><td align="center" style="padding:32px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
  <tr><td style="background:#0E1528;border-radius:20px 20px 0 0;padding:30px 36px 26px">
    <img src="${SITE}/email-logo.png" width="205" height="35" alt="Avelon Academy" style="display:block;border:0;width:205px;height:35px;color:#F3EFE6;font:800 20px Arial,sans-serif">
    <div style="font:700 26px/1.2 Arial,sans-serif;color:#FFFFFF;margin-top:24px">New message<span style="color:#E0B354">.</span></div>
    <div style="font:15px/1.5 Arial,sans-serif;color:#C3CBDD;margin-top:6px">From ${esc(from)} &middot; ${esc(about)}</div>
  </td></tr>
  <tr><td style="background:#FFFFFF;padding:28px 36px 10px">
    <p style="font:16px/1.6 Arial,sans-serif;color:#0B0D12;margin:0 0 16px">Hi ${esc(first || "there")},</p>
    ${flaggedNote ? `<p style="font:15px/1.6 Arial,sans-serif;color:#B45309;margin:0 0 16px"><b>${esc(flaggedNote)}</b></p>` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1EE;border-radius:14px;margin:0 0 22px"><tr><td style="padding:18px 22px;font:15px/1.6 Arial,sans-serif;color:#0B0D12">${esc(body).replace(/\n/g, "<br>")}</td></tr></table>
    <p style="margin:0 0 22px"><a href="${url}" style="background:#0E1528;color:#FFFFFF;padding:13px 24px;border-radius:999px;text-decoration:none;font:700 15px Arial,sans-serif;display:inline-block">Reply in My Avelon</a></p>
    <p style="font:13px/1.6 Arial,sans-serif;color:#5A5F6E;margin:0 0 28px">Please reply in My Avelon so everyone in the conversation sees it. Replies to this email go to Avelon Academy only.</p>
  </td></tr>
  <tr><td style="background:#0E1528;border-radius:0 0 20px 20px;padding:20px 36px"><div style="font:14px/1.6 Arial,sans-serif;color:#A3ACBF"><a href="${SITE}" style="color:#F3EFE6;text-decoration:none">avelonacademy.ca</a></div></td></tr>
</table></td></tr></table></body></html>`;
  const text = `Hi ${first || "there"},\n\n${flaggedNote ? flaggedNote + "\n\n" : ""}New message from ${from} (${about}):\n\n${body}\n\nReply in My Avelon: ${url}\nReplies to this email go to Avelon Academy only.`;
  return { html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await db.auth.getUser(token);
    if (!user) return json({ error: "Please log in again." }, 401);
    const myEmail = (user.email ?? "").toLowerCase();

    const b = await req.json();
    const body = String(b.body ?? "").replace(/\r\n/g, "\n").trim();
    if (!body) return json({ error: "Please write a message." }, 400);
    if (body.length > 2000) return json({ error: "Please keep messages under 2,000 characters." }, 400);

    const { data: k } = await db.from("students").select("id, first_name, subject, parent_id, tutor_id, student_email, active").eq("id", String(b.student_id ?? "")).maybeSingle();
    if (!k) return json({ error: "Student not found." }, 404);
    const { data: me } = await db.from("profiles").select("id, role, full_name, archived_at").eq("id", user.id).maybeSingle();
    if (!me || me.archived_at) return json({ error: "Your account can't send messages." }, 403);

    let role: string | null = null;
    if (me.role === "admin") role = "admin";
    else if (k.tutor_id === me.id) role = "tutor";
    else if (k.student_email && k.student_email.toLowerCase() === myEmail) role = "student";
    else if (k.parent_id === me.id) role = "parent";
    if (!role) return json({ error: "You can't message about this student." }, 403);
    if (!k.active && role !== "admin") return json({ error: "This student is no longer active." }, 403);

    const name = role === "admin" ? "Avelon Academy" : role === "student" ? k.first_name : (me.full_name || myEmail.split("@")[0]).split(" ")[0];
    const flagged = role !== "admin" && looksLikeContact(body);
    const { data: msg, error } = await db.from("messages").insert({ student_id: k.id, sender_id: me.id, sender_name: name, sender_role: role, body, flagged }).select().single();
    if (error) return json({ error: "Couldn't send: " + error.message }, 500);
    await db.from("message_reads").upsert({ user_id: me.id, student_id: k.id, last_read_at: new Date().toISOString() });

    // Who to alert: everyone in the thread except the sender. Admin is alerted only for flagged messages.
    const ids = [k.parent_id, k.tutor_id].filter(Boolean) as string[];
    const { data: profs } = await db.from("profiles").select("id, email, full_name, archived_at").in("id", ids);
    const P = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
    const to: { email: string; first: string }[] = [];
    const add = (email: string | null | undefined, first: string) => {
      const e = (email ?? "").toLowerCase();
      if (e && e !== myEmail && !to.some((x) => x.email === e)) to.push({ email: e, first });
    };
    if (P[k.parent_id] && !P[k.parent_id].archived_at) add(P[k.parent_id].email, (P[k.parent_id].full_name || "").split(" ")[0]);
    if (k.student_email) add(k.student_email, k.first_name);
    if (k.tutor_id && P[k.tutor_id]) add(P[k.tutor_id].email, (P[k.tutor_id].full_name || "").split(" ")[0]);

    const about = `${k.first_name}${k.subject ? "'s " + k.subject : ""}`;
    const fromLabel = role === "admin" ? "Avelon Academy" : `${name} (${role})`;
    const since = new Date(Date.now() - QUIET_MIN * 60000).toISOString();
    const { data: recent } = await db.from("message_notices").select("email, sent_at").eq("student_id", k.id).gte("sent_at", since);
    const quiet = new Set((recent ?? []).map((r) => r.email));
    for (const r of to) {
      if (quiet.has(r.email)) continue;
      const m = alertEmail(r.first, fromLabel, about, body);
      await sendEmail(r.email, `New message about ${about}`, m.html, m.text);
      await db.from("message_notices").upsert({ student_id: k.id, email: r.email, sent_at: new Date().toISOString() });
    }
    if (flagged) {
      const m = alertEmail("Sadman", fromLabel, about, body, "Flagged: this message looks like it shares contact details or an outside link. Review it in the admin console under Messages.");
      await sendEmail(ADMIN, `Flagged message about ${about}`, m.html, m.text);
    }
    return json({ ok: true, message: msg });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
