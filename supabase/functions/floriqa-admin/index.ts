// Floriqa — gestion des adresses manager @floriqa.xyz (super admins seulement)
//  action "create"   : { local, password, forward_email, display_name, is_super }
//  action "update"   : { email, password?, forward_email?, display_name? }
//  action "delete"   : { email }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function findUser(email: string) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data.users.length) return null;
    const u = data.users.find((x) => (x.email || "").toLowerCase() === email);
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  const { data: me } = await db.auth.getUser(jwt);
  if (!me?.user) return json({ error: "Not signed in." }, 401);
  const { data: sup } = await db.from("floriqa_members").select("user_id").eq("user_id", me.user.id).eq("role", "admin").maybeSingle();
  if (!sup) return json({ error: "Only full-access admins can manage manager addresses." }, 403);

  let b: any = {};
  try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const pw = b.password ? String(b.password) : "";
  if (pw && pw.length < 8) return json({ error: "The password must be at least 8 characters." }, 400);
  const fwd = b.forward_email ? String(b.forward_email).trim().toLowerCase() : null;
  if (fwd && !EMAIL_RE.test(fwd)) return json({ error: "Invalid forwarding e-mail." }, 400);

  if (b.action === "create") {
    const local = String(b.local || "").trim().toLowerCase();
    if (!/^[a-z0-9._+-]{1,60}$/.test(local) || local.startsWith("booking")) return json({ error: "Invalid address name." }, 400);
    const email = `${local}@floriqa.xyz`;
    if (!pw) return json({ error: "A password is required." }, 400);
    const { data: exists } = await db.from("floriqa_managers").select("email").eq("email", email).maybeSingle();
    if (exists) return json({ error: "This address already exists." }, 409);
    let u = await findUser(email);
    if (u) {
      const { error } = await db.auth.admin.updateUserById(u.id, { password: pw, email_confirm: true });
      if (error) return json({ error: error.message }, 400);
    } else {
      const { data, error } = await db.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: { display_name: b.display_name || local } });
      if (error) return json({ error: error.message }, 400);
      u = data.user;
    }
    const name = String(b.display_name || "").trim() || local;
    const { error: e2 } = await db.from("floriqa_managers").insert({ email, user_id: u!.id, display_name: name, forward_email: fwd, is_super: !!b.is_super });
    if (e2) return json({ error: e2.message }, 400);
    if (b.is_super) await db.from("floriqa_members").upsert({ user_id: u!.id, display_name: name, email, role: "admin" }, { onConflict: "user_id" });
    return json({ ok: true, email });
  }

  const email = String(b.email || "").trim().toLowerCase();
  const { data: m } = await db.from("floriqa_managers").select("*").eq("email", email).maybeSingle();
  if (!m) return json({ error: "Unknown address." }, 404);
  const uid = m.user_id || (await findUser(email))?.id;

  if (b.action === "update") {
    if (pw) {
      if (!uid) return json({ error: "No account for this address." }, 400);
      const { error } = await db.auth.admin.updateUserById(uid, { password: pw });
      if (error) return json({ error: error.message }, 400);
      // révoque toutes les sessions ouvertes de l'ancien titulaire
      await db.rpc("floriqa_kill_sessions", { p_user: uid }).then(() => {}, () => {});
    }
    const patch: Record<string, unknown> = {};
    if ("forward_email" in b) patch.forward_email = fwd;
    if (b.display_name !== undefined) patch.display_name = String(b.display_name).trim() || email.split("@")[0];
    if (Object.keys(patch).length) {
      const { error } = await db.from("floriqa_managers").update(patch).eq("email", email);
      if (error) return json({ error: error.message }, 400);
      if (patch.display_name && m.is_super && uid) await db.from("floriqa_members").update({ display_name: patch.display_name }).eq("user_id", uid);
    }
    return json({ ok: true });
  }

  if (b.action === "delete") {
    if (m.is_super) return json({ error: "The full-access address cannot be deleted here." }, 400);
    await db.from("floriqa_managers").delete().eq("email", email);
    if (uid) await db.auth.admin.deleteUser(uid);
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
});
