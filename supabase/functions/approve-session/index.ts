// Avelon Academy: the "Yes, confirm class" / "Something's wrong" links from the email.
// Supabase > Edge Functions > name: approve-session  (turn "Verify JWT" OFF; the secret link token is the check)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { token, action, reason } = await req.json();
    if (!UUID.test(String(token))) return json({ error: "This link isn't valid." }, 400);

    const { data: s } = await db.from("sessions")
      .select("id, status, class_date, minutes, students(first_name)")
      .eq("approve_token", token).single();
    if (!s) return json({ error: "This link isn't valid." }, 404);

    const info = {
      student: (s as any).students?.first_name ?? "", date: s.class_date, minutes: s.minutes, status: s.status,
    };
    if (action === "view" || s.status !== "pending") return json(info);

    if (action === "approve") {
      await db.from("sessions").update({ status: "approved", approved_by: "family", approved_at: new Date().toISOString() })
        .eq("id", s.id).eq("status", "pending");
      return json({ ...info, status: "approved" });
    }
    if (action === "flag") {
      const r = String(reason ?? "").trim();
      if (r.length < 3) return json({ error: "Please tell us briefly what went wrong." }, 400);
      await db.from("sessions").update({ status: "flagged", flag_reason: r.slice(0, 500) })
        .eq("id", s.id).eq("status", "pending");
      const to = Deno.env.get("ADMIN_EMAIL");
      if (to) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: Deno.env.get("EMAIL_FROM"), to: [to],
            subject: `Class flagged: ${info.student}, ${info.date}`,
            text: `A family flagged ${info.student}'s ${info.minutes}-minute class on ${info.date}.\n\nReason: ${r}\n\nReview it in the portal admin page.`,
          }),
        });
      }
      return json({ ...info, status: "flagged" });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
