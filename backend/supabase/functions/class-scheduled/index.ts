// Avelon Academy: email the family (parent, and the student if they have their own email) when a weekly class time is added.
// Called by the portal right after a tutor or admin adds a weekly class.
// Supabase > Edge Functions > name: class-scheduled  (Verify JWT OFF; this code checks the login itself)
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
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
// Families are in Canada. A class set in a Canadian zone is shown in that zone; one set in Bangladesh time is shown in Mountain time.
const CANADA: Record<string, string> = {
  "America/Vancouver": "Pacific time", "America/Edmonton": "Mountain time", "America/Regina": "Saskatchewan time",
  "America/Winnipeg": "Central time", "America/Toronto": "Eastern time", "America/Halifax": "Atlantic time", "America/St_Johns": "Newfoundland time",
};

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM"), to: [to], subject, html, text, reply_to: ADMIN }),
  });
  if (!res.ok) console.error("Email failed", await res.text());
}

function zparts(ms: number, tz: string) {
  const o: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
}
function zoneOffset(ms: number, tz: string) { const p = zparts(ms, tz); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - (ms - (ms % 1000)); }
function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string) { const g = Date.UTC(y, m - 1, d, hh, mm); const t = g - zoneOffset(g, tz); return g - zoneOffset(t, tz); }
// The first start time of this weekly class from now on.
function firstClass(slot: any) {
  const [hh, mm] = String(slot.start_time).split(":").map(Number);
  const now = Date.now();
  for (let i = 0; i <= 8; i++) {
    const p = zparts(now + i * 864e5, slot.timezone);
    if (WD[p.weekday] !== slot.weekday) continue;
    const t = zonedToUtc(+p.year, +p.month, +p.day, hh, mm, slot.timezone);
    if (t > now) return t;
  }
  return now;
}
const fmt = (ms: number, tz: string, o: Intl.DateTimeFormatOptions) => new Date(ms).toLocaleString("en-CA", { timeZone: tz, ...o });

function calLink(slot: any, start: number, who: string) {
  const f = (q: Record<string, string>) => `${q.year}${q.month}${q.day}T${String(+q.hour % 24).padStart(2, "0")}${q.minute}00`;
  const u = new URL("https://calendar.google.com/calendar/render");
  u.searchParams.set("action", "TEMPLATE");
  u.searchParams.set("text", `Avelon class: ${who}`);
  u.searchParams.set("dates", `${f(zparts(start, slot.timezone))}/${f(zparts(start + slot.minutes * 60000, slot.timezone))}`);
  u.searchParams.set("ctz", slot.timezone);
  u.searchParams.set("recur", "RRULE:FREQ=WEEKLY");
  if (slot.meet_link) { u.searchParams.set("location", slot.meet_link); u.searchParams.set("details", `Join on Google Meet: ${slot.meet_link}`); }
  return u.toString();
}

function scheduleEmail(first: string, kid: any, tutor: string, slot: any, isStudent: boolean) {
  const start = firstClass(slot);
  const tz = CANADA[slot.timezone] ? slot.timezone : "America/Edmonton";
  const zone = CANADA[tz];
  const day = DAYS[WD[zparts(start, tz).weekday]];
  const tp = zparts(start, tz), h = +tp.hour % 24;
  const time = `${h % 12 || 12}:${tp.minute} ${h < 12 ? "AM" : "PM"}`;
  const firstDay = fmt(start, tz, { weekday: "long", month: "long", day: "numeric" });
  const who = isStudent ? "Your" : `${esc(kid.first_name)}'s`;
  const intro = `${who} ${esc(kid.subject)} class${tutor ? ` with ${esc(tutor)}` : ""} is now on the schedule.`;
  const rows: [string, string][] = [
    ["When", `Every ${day} at ${time} (${zone})`],
    ["Length", `${slot.minutes} minutes`],
    ["First class", firstDay],
    ["Google Meet", slot.meet_link ? `<a href="${esc(slot.meet_link)}" style="color:#1D4ED8">${esc(slot.meet_link)}</a>` : "Your tutor will add the link before class. It will be in My Avelon."],
  ];
  const cal = calLink(slot, start, `${kid.first_name} · ${kid.subject}`);
  const p = (t: string) => `<p style="font:16px/1.65 Arial,sans-serif;color:#0B0D12;margin:0 0 16px">${t}</p>`;
  const box = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1EE;border-radius:14px;margin:4px 0 22px"><tr><td style="padding:16px 22px">
    ${rows.map(([k, v]) => `<div style="font:15px/1.7 Arial,sans-serif;color:#0B0D12"><span style="color:#5A5F6E;display:inline-block;width:110px">${k}</span><b style="font-weight:600">${v}</b></div>`).join("")}</td></tr></table>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:#F1F1EE">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1EE"><tr><td align="center" style="padding:32px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
  <tr><td style="background:#0E1528;border-radius:20px 20px 0 0;padding:34px 36px 30px">
    <a href="${SITE}" style="text-decoration:none"><img src="${SITE}/email-logo.png" width="205" height="35" alt="Avelon Academy" style="display:block;border:0;width:205px;height:35px;color:#F3EFE6;font:800 20px Arial,sans-serif"></a>
    <div style="font:700 34px/1.1 Arial,sans-serif;color:#FFFFFF;margin-top:28px;letter-spacing:-1px">Class scheduled<span style="color:#E0B354">.</span></div>
  </td></tr>
  <tr><td style="background:#FFFFFF;padding:34px 36px 8px">
    ${p(`Hi ${esc(first || "there")},`)}${p(intro)}${box}
    <p style="margin:4px 0 14px"><a href="${cal}" style="background:#0E1528;color:#FFFFFF;padding:14px 26px;border-radius:999px;text-decoration:none;font:700 15px Arial,sans-serif;display:inline-block">Add to Google Calendar</a></p>
    <p style="font:14px/1.6 Arial,sans-serif;color:#5A5F6E;margin:0 0 24px">Google Calendar shows it in your own time zone. Class times and the Meet link are always in <a href="${SITE}/portal/" style="color:#1D4ED8">My Avelon</a>.</p>
    ${p("Need a different time? Just reply to this email.")}
    <p style="font:16px/1.5 Arial,sans-serif;color:#0B0D12;margin:0 0 34px">Warmly,<br><b>Sadman</b><br><span style="color:#5A5F6E">Founder, Avelon Academy</span></p>
  </td></tr>
  <tr><td style="background:#0E1528;border-radius:0 0 20px 20px;padding:24px 36px">
    <div style="font:14px/1.6 Arial,sans-serif;color:#A3ACBF"><a href="${SITE}" style="color:#F3EFE6;text-decoration:none">avelonacademy.ca</a> &nbsp;&middot;&nbsp; <a href="mailto:${ADMIN}" style="color:#F3EFE6;text-decoration:none">${ADMIN}</a></div>
  </td></tr>
</table></td></tr></table></body></html>`;
  const plain = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const text = `Hi ${first || "there"},\n\n${plain(intro)}\n\n${rows.map(([k, v]) => `${k}: ${plain(v)}`).join("\n")}\n\nAdd to Google Calendar: ${cal}\n\nClass times and the Meet link are always in My Avelon: ${SITE}/portal/\n\nNeed a different time? Just reply to this email.\n\nWarmly,\nSadman\nFounder, Avelon Academy`;
  const subject = `${isStudent ? "Your" : kid.first_name + "'s"} ${kid.subject} class: every ${day} at ${time}`;
  return { html, text, subject };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await db.auth.getUser(token);
    if (!user) return json({ error: "Please log in again." }, 401);
    const { slot_id } = await req.json();
    const { data: slot } = await db.from("class_slots").select("*").eq("id", String(slot_id ?? "")).maybeSingle();
    if (!slot) return json({ error: "That class time wasn't found." }, 404);
    const { data: kid } = await db.from("students").select("first_name, subject, parent_id, tutor_id, student_email, active").eq("id", slot.student_id).single();
    const { data: me } = await db.from("profiles").select("role").eq("id", user.id).single();
    if (me?.role !== "admin" && kid?.tutor_id !== user.id) return json({ error: "Only the tutor or an admin can do this." }, 403);
    if (!kid || kid.active === false) return json({ ok: true, sent: 0 });

    const ids = [kid.parent_id, kid.tutor_id].filter(Boolean);
    const { data: people } = await db.from("profiles").select("id, email, full_name").in("id", ids);
    const P = Object.fromEntries((people ?? []).map((x) => [x.id, x]));
    const tutor = (P[kid.tutor_id]?.full_name || "").split(" ")[0];
    const parent = P[kid.parent_id];
    let sent = 0;
    if (parent?.email) {
      const m = scheduleEmail((parent.full_name || "").split(" ")[0], kid, tutor, slot, false);
      await sendEmail(parent.email, m.subject, m.html, m.text); sent++;
    }
    const se = (kid.student_email || "").toLowerCase();
    if (se && se !== (parent?.email || "").toLowerCase()) {
      const m = scheduleEmail(kid.first_name, kid, tutor, slot, true);
      await sendEmail(se, m.subject, m.html, m.text); sent++;
    }
    return json({ ok: true, sent });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
