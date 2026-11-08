// Avelon Academy: sign in with the 6-digit code from a "your account is ready" email (valid 24 hours, single use, 5 tries).
// Supabase > Edge Functions > name: redeem-invite  (Verify JWT OFF: used before sign-in; checks are below)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BAD = "That code didn't work. Check it, or press \"Email me a sign-in code\" for a new one.";

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Not allowed." }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const email = String(b.email ?? "").trim().toLowerCase();
    const code = String(b.code ?? "").replace(/\D/g, "");
    if (!email || code.length !== 6) return json({ error: BAD }, 400);

    const { data: inv } = await db.from("invite_codes").select("id, code_hash, expires_at, attempts")
      .eq("email", email).is("used_at", null).gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!inv) return json({ error: BAD }, 400);
    if (inv.attempts >= 5) return json({ error: "Too many tries. Press \"Email me a sign-in code\" to get a new one." }, 429);

    const pepper = Deno.env.get("CRON_SECRET") ?? "avelon";
    if ((await sha256(`${email}:${code}:${pepper}`)) !== inv.code_hash) {
      await db.from("invite_codes").update({ attempts: inv.attempts + 1 }).eq("id", inv.id);
      return json({ error: BAD }, 400);
    }
    await db.from("invite_codes").update({ used_at: new Date().toISOString() }).eq("id", inv.id);

    // Make sure the account exists (a student's account is created on first sign-in), then mint a one-time sign-in token.
    const { data: prof } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
    if (!prof) {
      const { error } = await db.auth.admin.createUser({ email, email_confirm: true });
      if (error && !/already/i.test(error.message)) { console.error(error); return json({ error: BAD }, 400); }
    }
    const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data?.properties?.hashed_token) { console.error(error); return json({ error: "Couldn't sign you in. Please try again." }, 500); }
    return json({ token_hash: data.properties.hashed_token });
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
