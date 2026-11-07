// Avelon Academy: Stripe tells us when a card is saved or a payment succeeds/fails.
// Supabase > Edge Functions > name: stripe-webhook  (turn "Verify JWT" OFF; Stripe's signature is checked instead)
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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
