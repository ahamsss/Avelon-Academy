// Avelon Academy: every Monday, charge each family's saved card for their approved classes.
// Supabase > Edge Functions > name: weekly-billing  (turn "Verify JWT" OFF; this code checks the cron secret or an admin login)
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SITE = Deno.env.get("SITE_URL") ?? "https://avelonacademy.ca";

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM"), to: [to], subject, html, reply_to: Deno.env.get("ADMIN_EMAIL") }),
  });
  if (!res.ok) console.error("Email failed", await res.text());
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await allowed(req))) return json({ error: "Not allowed." }, 401);
  // Optional: {"parent_ids": [...]} charges only those families (admin "Charge selected"). No list = everyone (Monday run).
  let only: Set<string> | null = null;
  try { const body = await req.json(); if (Array.isArray(body?.parent_ids)) only = new Set(body.parent_ids.map(String)); } catch { /* no body */ }
  if (only && !only.size) return json({ error: "Pick at least one family." }, 400);

  const { data: rows, error } = await db.from("sessions")
    .select("id, class_date, minutes, amount_cents, trial_number, students!inner(first_name, parent_id, trial_status)")
    .eq("status", "approved").is("charge_id", null).gt("amount_cents", 0)
    .order("class_date");
  if (error) return json({ error: error.message }, 500);

  // Trial classes 2 and 3 are only charged once the family decides to continue.
  const billable = (rows ?? []).filter((r: any) =>
    !(r.trial_number === 2 || r.trial_number === 3) || r.students.trial_status === "continuing");

  const byParent = new Map<string, any[]>();
  for (const r of billable as any[]) {
    const k = r.students.parent_id;
    if (only && !only.has(k)) continue;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(r);
  }

  const summary = { charged: [] as string[], failed: [] as string[], noCard: [] as string[] };

  for (const [parentId, items] of byParent) {
    const { data: parent } = await db.from("profiles")
      .select("id, email, full_name, stripe_customer_id, default_payment_method, card_last4").eq("id", parentId).single();
    if (!parent) continue;
    const total = items.reduce((a, r) => a + r.amount_cents, 0);
    const lines = items.map((r) =>
      `<tr><td>${r.class_date}</td><td>${esc(r.students.first_name)}</td><td>${r.minutes} min</td><td style="text-align:right">${money(r.amount_cents)}</td></tr>`).join("");
    const table = `<table cellpadding="6" style="border-collapse:collapse;width:100%">${lines}<tr><td colspan="3"><b>Total</b></td><td style="text-align:right"><b>${money(total)} CAD</b></td></tr></table>`;

    if (!parent.stripe_customer_id || !parent.default_payment_method) {
      summary.noCard.push(`${parent.email} (${money(total)})`);
      await sendEmail(parent.email, "Please add a card for your Avelon classes",
        `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><p>Hi ${esc(parent.full_name || "there")},</p><p>We couldn't bill last week's classes because there's no card on file:</p>${table}<p><a href="${SITE}/portal/">Add a card in your portal</a> and we'll charge it on the next billing day.</p></div>`);
      continue;
    }

    const { data: charge, error: cErr } = await db.from("charges")
      .insert({ parent_id: parentId, amount_cents: total }).select("id").single();
    if (cErr || !charge) { console.error(cErr); continue; }
    await db.from("sessions").update({ charge_id: charge.id }).in("id", items.map((r) => r.id)).is("charge_id", null);

    try {
      const pi = await stripe.paymentIntents.create({
        amount: total, currency: "cad",
        customer: parent.stripe_customer_id, payment_method: parent.default_payment_method,
        off_session: true, confirm: true,
        description: `Avelon Academy classes (${items.length})`,
        receipt_email: parent.email,
        metadata: { charge_id: charge.id },
      }, { idempotencyKey: `avelon-charge-${charge.id}` });

      if (pi.status === "succeeded") {
        await db.from("charges").update({ status: "succeeded", stripe_payment_intent: pi.id }).eq("id", charge.id);
        summary.charged.push(`${parent.email} ${money(total)}`);
        await sendEmail(parent.email, `Your Avelon receipt: ${money(total)} CAD`,
          `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><p>Hi ${esc(parent.full_name || "there")},</p><p>We charged your card${parent.card_last4 ? ` ending ${parent.card_last4}` : ""} for these classes:</p>${table}<p>Thank you! Questions? Just reply to this email.</p></div>`);
      } else {
        await db.from("charges").update({ stripe_payment_intent: pi.id }).eq("id", charge.id); // webhook will finish it
      }
    } catch (e: any) {
      const msg = e?.raw?.message ?? e?.message ?? "Payment failed";
      await db.from("charges").update({ status: "failed", failure_message: msg, stripe_payment_intent: e?.raw?.payment_intent?.id ?? null }).eq("id", charge.id);
      await db.from("sessions").update({ charge_id: null }).eq("charge_id", charge.id);
      summary.failed.push(`${parent.email} ${money(total)}: ${msg}`);
      await sendEmail(parent.email, "Your Avelon payment didn't go through",
        `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto"><p>Hi ${esc(parent.full_name || "there")},</p><p>We tried to charge ${money(total)} CAD for last week's classes, but the card was declined (${msg}).</p><p><a href="${SITE}/portal/">Update your card in the portal</a>. We'll try again on the next billing day.</p></div>`);
    }
  }

  const admin = Deno.env.get("ADMIN_EMAIL");
  if (admin && (summary.charged.length || summary.failed.length || summary.noCard.length)) {
    await sendEmail(admin, "Avelon weekly billing summary",
      `<pre style="font-family:monospace">Charged:\n${summary.charged.join("\n") || "-"}\n\nFailed:\n${summary.failed.join("\n") || "-"}\n\nNo card on file:\n${summary.noCard.join("\n") || "-"}</pre>`);
  }
  return json(summary);
});
