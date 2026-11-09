// Avelon Academy: start Stripe's secure "save a card" page for the logged-in parent.
// Supabase > Edge Functions > name: create-card-session  (turn "Verify JWT" OFF; this code checks the login itself)
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SITE = Deno.env.get("SITE_URL") ?? "https://avelonacademy.ca";
const TERMS_VERSION = "2026-11-08";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await db.auth.getUser(token);
    if (!user) return json({ error: "Please log in again." }, 401);

    const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).single();
    if (!profile) return json({ error: "Profile not found." }, 404);

    // The parent must accept the Terms (including the weekly card authorization) before saving a card.
    const body = await req.json().catch(() => ({}));
    if (body.agree !== true && !profile.terms_accepted_at) return json({ error: "Please tick the box to agree to the Terms first." }, 400);
    if (body.agree === true) await db.from("profiles").update({ terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION }).eq("id", profile.id);

    let customer = profile.stripe_customer_id as string | null;
    if (!customer) {
      const c = await stripe.customers.create({
        email: profile.email,
        name: profile.full_name || undefined,
        metadata: { profile_id: profile.id },
      });
      customer = c.id;
      await db.from("profiles").update({ stripe_customer_id: customer }).eq("id", profile.id);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer,
      payment_method_types: ["card"],
      success_url: `${SITE}/portal/?card=saved`,
      cancel_url: `${SITE}/portal/?card=cancelled`,
      custom_text: {
        submit: {
          message:
            "You authorize Avelon Academy to charge this card every Monday for logged classes past their 48-hour report window, at the prices in My Avelon, until you remove the card or stop classes. Cancel any time by emailing contact@avelonacademy.ca.",
        },
      },
    });
    return json({ url: session.url });
  } catch (e) {
    console.error(e);
    return json({ error: "Could not open the card page. Please try again." }, 500);
  }
});
