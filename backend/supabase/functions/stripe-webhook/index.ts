// Avelon Academy: Stripe tells us when a card is saved or a payment succeeds/fails.
// Supabase > Edge Functions > name: stripe-webhook  (turn "Verify JWT" OFF; Stripe's signature is checked instead)
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SITE = Deno.env.get("SITE_URL") ?? "https://avelonacademy.ca";
const ADMIN = Deno.env.get("ADMIN_EMAIL") ?? "contact@avelonacademy.ca";
const esc = (x: string) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// A copy of the key agreement details, emailed when a card is saved (Alberta's Internet Sales Contract Regulation
// asks for a copy of the contract within 15 days, with the consumer's name and the date).
async function agreementEmail(p: { email: string; full_name: string | null; terms_accepted_at: string | null; terms_version: string | null }, brand: string, last4: string) {
  const date = new Date(p.terms_accepted_at || Date.now()).toLocaleDateString("en-CA", { timeZone: "America/Edmonton", year: "numeric", month: "long", day: "numeric" });
  const li = (t: string) => `<li style="margin:0 0 8px">${t}</li>`;
  const items = [
    `<b>Business:</b> Avelon Academy, operated by Sadman Ahmed (sole proprietor), Alberta, Canada · <a href="mailto:${ADMIN}">${ADMIN}</a> · ${SITE.replace("https://", "")}`,
    `<b>Customer:</b> ${esc(p.full_name || p.email)} (${esc(p.email)}) · <b>Agreed on:</b> ${esc(date)} · Terms version ${esc(p.terms_version || "2026-11-08")}`,
    `<b>Service:</b> live online tutoring for Grades 1–10 by video call, one-on-one or in small groups. Class times and links are in My Avelon.`,
    `<b>Prices (per hour, CAD):</b> one-on-one $25.00 · small group $20.00 · Bangla $20.00. No GST is currently charged. Each class is charged at its booked length.`,
    `<b>Payment:</b> your ${esc(brand.toUpperCase())} card ending ${esc(last4)} is charged every Monday for classes logged more than 48 hours earlier with no problem reported. You get a receipt for every charge.`,
    `<b>Problems and refunds:</b> report a problem with a class within 48 hours of it being logged and it won't be charged until sorted. Question any charge within 14 days and we refund mistakes.`,
    `<b>Cancelling:</b> no minimum term. Stop or pause any time, and cancel the card authorization by emailing us. You pay only for classes already taken (and classes cancelled with less than 24 hours' notice).`,
  ];
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#F1F1EE"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F1EE"><tr><td align="center" style="padding:32px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
  <tr><td style="background:#0E1528;border-radius:20px 20px 0 0;padding:30px 36px 26px">
    <img src="${SITE}/email-logo.png" width="205" height="35" alt="Avelon Academy" style="display:block;border:0;width:205px;height:35px;color:#F3EFE6;font:800 20px Arial,sans-serif">
    <div style="font:700 26px/1.2 Arial,sans-serif;color:#FFFFFF;margin-top:24px">Your card is saved<span style="color:#E0B354">.</span></div>
    <div style="font:15px/1.5 Arial,sans-serif;color:#C3CBDD;margin-top:6px">Here's a copy of your agreement with Avelon Academy. Please keep it.</div>
  </td></tr>
  <tr><td style="background:#FFFFFF;padding:28px 36px 10px;font:15px/1.6 Arial,sans-serif;color:#0B0D12">
    <ul style="padding-left:20px;margin:0 0 18px">${items.map(li).join("")}</ul>
    <p style="margin:0 0 26px">The full Terms you agreed to are at <a href="${SITE}/terms.html" style="color:#1D4ED8">${SITE.replace("https://", "")}/terms.html</a> (you can print or save them there), with our <a href="${SITE}/privacy.html" style="color:#1D4ED8">Privacy Policy</a>. Questions? Just reply to this email.</p>
  </td></tr>
  <tr><td style="background:#0E1528;border-radius:0 0 20px 20px;padding:20px 36px"><div style="font:14px/1.6 Arial,sans-serif;color:#A3ACBF">Avelon Academy · <a href="${SITE}" style="color:#F3EFE6;text-decoration:none">avelonacademy.ca</a></div></td></tr>
</table></td></tr></table></body></html>`;
  const text = `Your card is saved. Here's a copy of your agreement with Avelon Academy.\n\n${items.map((t) => "- " + t.replace(/<[^>]+>/g, "")).join("\n")}\n\nFull Terms: ${SITE}/terms.html\nPrivacy Policy: ${SITE}/privacy.html`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM"), to: [p.email], bcc: [ADMIN], subject: "Your Avelon Academy agreement and card", html, text, reply_to: ADMIN }),
  });
  if (!res.ok) console.error("Agreement email failed", await res.text());
}

Deno.serve(async (req) => {
  const signature = req.headers.get("Stripe-Signature");
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, signature!, Deno.env.get("STRIPE_WEBHOOK_SECRET")!, undefined, cryptoProvider,
    );
  } catch (e) {
    console.error("Bad signature", e);
    return new Response("Bad signature", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.mode === "setup" && s.setup_intent && s.customer) {
        const si = await stripe.setupIntents.retrieve(s.setup_intent as string);
        const pmId = si.payment_method as string;
        const pm = await stripe.paymentMethods.retrieve(pmId);
        await stripe.customers.update(s.customer as string, {
          invoice_settings: { default_payment_method: pmId },
        });
        await db.from("profiles").update({
          default_payment_method: pmId,
          card_brand: pm.card?.brand ?? null,
          card_last4: pm.card?.last4 ?? null,
        }).eq("stripe_customer_id", s.customer as string);
        const { data: prof } = await db.from("profiles").select("email, full_name, terms_accepted_at, terms_version").eq("stripe_customer_id", s.customer as string).maybeSingle();
        if (prof?.email) await agreementEmail(prof, pm.card?.brand ?? "card", pm.card?.last4 ?? "");
      }
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      if (pi.metadata?.charge_id) {
        await db.from("charges").update({ status: "succeeded", failure_message: null })
          .eq("id", pi.metadata.charge_id);
      }
    }

    if (event.type === "payment_intent.payment_failed") {
      const pi = event.data.object as Stripe.PaymentIntent;
      if (pi.metadata?.charge_id) {
        await db.from("charges").update({
          status: "failed",
          failure_message: pi.last_payment_error?.message ?? "Payment failed",
        }).eq("id", pi.metadata.charge_id);
        // Free the classes so next week's run tries again.
        await db.from("sessions").update({ charge_id: null }).eq("charge_id", pi.metadata.charge_id);
      }
    }
  } catch (e) {
    console.error(e);
    return new Response("Handler error", { status: 500 });
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});
