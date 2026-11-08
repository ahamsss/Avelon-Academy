// Avelon Academy: admin removes a student or a family.
// Nothing billed yet (no classes, no payments) -> deleted completely, files included.
// Any classes or payments -> archived: records kept for taxes and disputes, schedule cleared,
// student set inactive, and (for a family) the login is blocked. {"action":"restore"} unblocks a family.
// Supabase > Edge Functions > name: remove-person  (Verify JWT OFF; this code checks the admin login itself)
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function removeFiles(studentIds: string[]) {
  if (!studentIds.length) return;
  const { data: files } = await db.from("class_files").select("path").in("student_id", studentIds);
  if (files?.length) await db.storage.from("class-files").remove(files.map((f) => f.path));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user } } = await db.auth.getUser(token);
    if (!user) return json({ error: "Please log in again." }, 401);
    const { data: me } = await db.from("profiles").select("role").eq("id", user.id).single();
    if (me?.role !== "admin") return json({ error: "Admins only." }, 403);

    const { kind, id, action } = await req.json();
    if (!id) return json({ error: "Missing id." }, 400);

    if (kind === "student") {
      const { data: st } = await db.from("students").select("id, first_name").eq("id", id).maybeSingle();
      if (!st) return json({ error: "Student not found." }, 404);
      const { count } = await db.from("sessions").select("id", { count: "exact", head: true }).eq("student_id", id);
      if (!count) {
        await removeFiles([id]);
        const { error } = await db.from("students").delete().eq("id", id);
        if (error) throw error;
        return json({ result: "deleted", name: st.first_name });
      }
      await db.from("class_slots").delete().eq("student_id", id);
      await db.from("students").update({ active: false }).eq("id", id);
      return json({ result: "archived", name: st.first_name });
    }

    if (kind === "parent") {
      const { data: p } = await db.from("profiles").select("id, role, full_name, email").eq("id", id).maybeSingle();
      if (!p) return json({ error: "Family not found." }, 404);
      if (p.role !== "parent") return json({ error: "Only family accounts can be removed here." }, 400);
      const name = p.full_name || p.email;

      if (action === "restore") {
        await db.auth.admin.updateUserById(id, { ban_duration: "none" });
        await db.from("profiles").update({ archived_at: null }).eq("id", id);
        return json({ result: "restored", name });
      }

      const { data: kids } = await db.from("students").select("id").eq("parent_id", id);
      const kidIds = (kids ?? []).map((k) => k.id);
      const { count: charges } = await db.from("charges").select("id", { count: "exact", head: true }).eq("parent_id", id);
      const { count: classes } = kidIds.length
        ? await db.from("sessions").select("id", { count: "exact", head: true }).in("student_id", kidIds)
        : { count: 0 };

      if (!charges && !classes) {
        await removeFiles(kidIds);
        const { error } = await db.auth.admin.deleteUser(id); // cascades: profile -> students -> schedule, files, reports
        if (error) throw error;
        await db.from("invite_codes").delete().eq("email", p.email);
        return json({ result: "deleted", name });
      }

      if (kidIds.length) {
        await db.from("class_slots").delete().in("student_id", kidIds);
        await db.from("students").update({ active: false }).in("id", kidIds);
      }
      await db.from("profiles").update({ archived_at: new Date().toISOString() }).eq("id", id);
      await db.auth.admin.updateUserById(id, { ban_duration: "876000h" }); // blocks sign-in; undo with Restore
      await db.from("invite_codes").delete().eq("email", p.email);
      return json({ result: "archived", name });
    }

    return json({ error: "Unknown type." }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});
