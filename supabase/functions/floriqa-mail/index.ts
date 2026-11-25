// Floriqa — e-mails des conversations de booking
//  - type "booking" : nouvelle demande -> confirmation au promoteur + alerte au manager
//  - type "message" : réponse du manager -> e-mail au promoteur ; note de l'artiste -> e-mail au manager
//  - type "inbound" : réponse e-mail du promoteur (reçue par Cloudflare) -> ajoutée au fil + alerte manager
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const INBOUND_SECRET = Deno.env.get("FLORIQA_INBOUND_SECRET") || "";
const FALLBACK_MANAGER = Deno.env.get("FLORIQA_FALLBACK_MANAGER") || "";
const DOMAIN = Deno.env.get("FLORIQA_MAIL_DOMAIN") || "floriqa.xyz";
const SITE = Deno.env.get("FLORIQA_SITE") || "https://floriqa.xyz";

const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

async function send(to: string, subject: string, text: string, replyTo: string, fromName: string) {
  if (!RESEND) return { ok: false, error: "no_key" };
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1f29;white-space:pre-wrap">${esc(text)}</div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: `${fromName} <booking@${DOMAIN}>`, to: [to], reply_to: replyTo, subject, text, html }),
  });
  if (!r.ok) return { ok: false, error: (await r.text()).slice(0, 300) };
  return { ok: true };
}

async function loadBooking(id: string) {
  const { data: b } = await db.from("floriqa_bookings").select("*").eq("id", id).maybeSingle();
  if (!b) return null;
  let artist = null;
  if (b.artist_id) artist = (await db.from("floriqa_artists").select("id,name,manager_email").eq("id", b.artist_id).maybeSingle()).data;
  const manager = artist?.manager_email || FALLBACK_MANAGER;
  const subject = `Booking ${b.artist_name} — ${b.event} (${b.dates})`;
  const replyTo = `booking+${b.reply_token}@${DOMAIN}`;
  return { b, artist, manager, subject, replyTo };
}

function summary(b: any) {
  const yn = (v: boolean, d: string) => (v ? `Yes${d ? " — " + d : ""}` : "No");
  return [
    `Artist: ${b.artist_name}`, `Organisation: ${b.organization}`, `Promoter: ${b.promoter}`, `Phone: ${b.phone}`, `E-mail: ${b.email}`,
    `Event: ${b.event}`, `Venue: ${b.venue}`, `Date(s): ${b.dates}`, `Line-up: ${b.lineup || "—"}`, `City: ${b.city}, ${b.country}`,
    `Social: ${b.social_link || "—"}`, `B2B: ${b.b2b || "No"}`, `Duration: ${b.duration}`, `Time: ${b.perf_time}`, `Net fee: ${b.fee} €`,
    `Transport: ${yn(b.transport, b.transport_details)}`, `Accommodation: ${yn(b.accommodation, b.accommodation_details)}`,
    `Hospitality: ${yn(b.hospitality, b.hospitality_details)}`,
  ].join("\n");
}

async function setStatus(id: string, r: { ok: boolean; error?: string }) {
  await db.from("floriqa_messages").update({ email_status: r.ok ? "sent" : r.error === "no_key" ? "pending" : "failed", email_error: r.ok ? null : r.error }).eq("id", id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  // ---------- nouvelle demande de booking ----------
  if (body.type === "booking") {
    const ctx = await loadBooking(body.id);
    if (!ctx) return json({ error: "not found" }, 404);
    const { b, manager, subject, replyTo } = ctx;
    if (b.notified_at || Date.now() - new Date(b.created_at).getTime() > 15 * 60 * 1000) return json({ ok: true, skipped: true });
    await db.from("floriqa_bookings").update({ notified_at: new Date().toISOString() }).eq("id", b.id);
    const toPromoter = await send(b.email, subject,
      `Hello ${b.promoter},\n\nThank you for your booking request for ${b.artist_name}. Our team will get back to you shortly.\nYou can reply directly to this e-mail to continue the conversation.\n\n— Floriqa Booking\n\n----------\n${summary(b)}`,
      replyTo, "Floriqa Booking");
    let toManager = { ok: false, error: "no_manager" };
    if (manager) toManager = await send(manager, `[Nouveau] ${subject}`,
      `Nouvelle demande de booking pour ${b.artist_name}.\nRépondez depuis l'admin (pas depuis cet e-mail) : ${SITE}/admin/?b=${b.id}\n\n${summary(b)}`,
      `no-reply@${DOMAIN}`, "Floriqa");
    return json({ ok: true, promoter: toPromoter, manager: toManager });
  }

  // ---------- message écrit dans l'admin (manager) ou la Room (artiste) ----------
  if (body.type === "message") {
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: u } = await db.auth.getUser(jwt);
    if (!u?.user) return json({ error: "auth" }, 401);
    const { data: m } = await db.from("floriqa_messages").select("*").eq("id", body.id).maybeSingle();
    if (!m || m.author !== u.user.id) return json({ error: "not allowed" }, 403);
    if (m.email_status === "sent") return json({ ok: true, skipped: true });
    const ctx = await loadBooking(m.booking_id);
    if (!ctx) return json({ error: "not found" }, 404);
    const { b, manager, subject, replyTo } = ctx;
    let r;
    if (m.author_kind === "manager") {
      // le promoteur ne reçoit QUE les messages du manager
      r = await send(b.email, `Re: ${subject}`, `${m.body}\n\n— ${m.author_name || "Floriqa Booking"}`, replyTo, m.author_name ? `${m.author_name} · Floriqa` : "Floriqa Booking");
    } else if (m.author_kind === "artist") {
      // note interne de l'artiste : uniquement au manager
      r = manager
        ? await send(manager, `[Note interne de ${m.author_name || b.artist_name}] ${subject}`,
            `${m.body}\n\n(Note interne : le promoteur ne la voit pas. Ne répondez pas à cet e-mail.)\nFil complet : ${SITE}/admin/?b=${b.id}`,
            `no-reply@${DOMAIN}`, "Floriqa")
        : { ok: false, error: "no_manager" };
    } else return json({ error: "kind" }, 400);
    await setStatus(m.id, r);
    return json({ ok: r.ok, error: r.error });
  }

  // ---------- réponse e-mail du promoteur (depuis Cloudflare Email Worker) ----------
  if (body.type === "inbound") {
    if (!INBOUND_SECRET || req.headers.get("x-floriqa-inbound") !== INBOUND_SECRET) return json({ error: "auth" }, 401);
    const token = String(body.to || "").match(/booking\+([a-f0-9]{32})@/i)?.[1];
    if (!token) return json({ error: "no token" }, 400);
    const { data: b } = await db.from("floriqa_bookings").select("id").eq("reply_token", token.toLowerCase()).maybeSingle();
    if (!b) return json({ error: "unknown thread" }, 404);
    const text = String(body.text || "").slice(0, 20000).trim() || "(message vide)";
    const { data: m } = await db.from("floriqa_messages").insert({
      booking_id: b.id, author_kind: "promoter", visibility: "external", author_name: String(body.from || "Promoter").slice(0, 200), body: text, email_status: "none",
    }).select().single();
    const ctx = await loadBooking(b.id);
    if (ctx?.manager) await send(ctx.manager, `Re: ${ctx.subject}`, `Réponse du promoteur (${body.from}) :\n\n${text}\n\nRépondez depuis l'admin (pas depuis cet e-mail) : ${SITE}/admin/?b=${b.id}`, `no-reply@${DOMAIN}`, "Floriqa");
    return json({ ok: true, id: m?.id });
  }

  return json({ error: "unknown type" }, 400);
});
