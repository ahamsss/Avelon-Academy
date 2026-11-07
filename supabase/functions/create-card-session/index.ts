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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await db.auth.getUser(token);
    if (!user) return json({ error: "Please log in again." }, 401);

    const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).single();
    if (!profile) return json({ error: "Profile not found." }, 404);

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
            "Avelon Academy will charge this card every Monday for the previous week's approved classes, as set out in our Terms.",
        },
      },
    });
    return json({ url: session.url });
  } catch (e) {
    console.error(e);
    return json({ error: "Could not open the card page. Please try again." }, 500);
  }
});
