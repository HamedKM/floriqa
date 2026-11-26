// Floriqa — admin panel
const { sb, esc, media, buildChrome, toast, fmtDate, fmtSize, mail, authFlow, accountSettings } = Floriqa;
buildChrome({ negative: true });

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const show = (id) => ["auth", "denied", "panel"].forEach((x) => $("#" + x).classList.toggle("hidden", x !== id));
const MAX = 50 * 1024 * 1024;
const PUB = "floriqa-public";
const PK = "floriqa-presskit";
const SITE = location.origin + location.pathname.replace(/admin\/.*$/, "");
const STATUS = { new: "New", negotiating: "In negotiation", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled", unsuccessful: "Unsuccessful" };
const SCLASS = { new: "new", negotiating: "in_progress", confirmed: "accepted", completed: "archived", cancelled: "declined", unsuccessful: "declined" };
const PKCAT = { photo: "HD photos", presentation: "Presentations / riders", video: "Videos", audio: "Audio", admin: "Administrative documents", other: "Other" };
let me = null, user = null, managers = [], links = [];
const MGMT = "management@floriqa.xyz";
const myArtist = (id) => me.is_super || me.artists.includes(id);
// répondre au promoteur : manager assigné ; super admins quand management@ est assigné
const canNegotiate = (artistId) => !!artistId && links.some((l) => l.artist_id === artistId &&
  (l.manager_email === me.email || (me.is_super && l.manager_email === MGMT)));
const managersOf = (artistId) => links.filter((l) => l.artist_id === artistId).map((l) => l.manager_email);

$$("[data-logout]").forEach((b) => b.addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); }));

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session || session.user.is_anonymous) { show("auth"); return authFlow($("#auth"), { title: "Floriqa · Admin", onDone: boot }); }
  user = session.user;
  await sb.rpc("floriqa_claim_invite");
  const { data: m } = await sb.rpc("floriqa_staff_me");
  if (!m || (!m.is_super && !m.is_manager)) return show("denied");
  me = { ...m, display_name: m.name, user_id: user.id };
  $("#who").textContent = `${m.name}${m.is_super ? "" : " · manager"}`;
  $("#adminUrl").textContent = SITE + "admin/";
  document.body.classList.toggle("is-super", m.is_super);
  $$("[data-super]").forEach((el) => el.classList.toggle("hidden", !m.is_super));
  show("panel");
  await loadManagers();
  await loadArtists();
  await loadBookings();
  loadRequests();
  if (m.is_super) loadAdmins();
  accountSettings($("#account"), { name: m.name, email: user.email, redirect: location.origin + location.pathname, fixedEmail: m.is_manager });
  const wanted = new URLSearchParams(location.search).get("b");
  if (wanted) showBooking(wanted);
}

let roomsUI = null;
$$(".tab").forEach((t) => t.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
  $$("[data-pane]").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== t.dataset.tab));
  if (t.dataset.tab === "rooms") {
    roomsUI ||= Floriqa.mountRooms({
      user, myEmail: () => (user.email || "").toLowerCase(),
      myName: () => `${me.display_name} (Floriqa)`, defaultArtists: () => [],
    });
    roomsUI.load();
  }
}));

// =============== BOOKINGS ===============
let bookings = [], bkSel = null;
async function loadBookings() {
  const { data, error } = await sb.from("floriqa_bookings").select("*, floriqa_messages(count)").order("created_at", { ascending: false });
  if (error) return toast("Could not load bookings.", "err");
  bookings = data;
  const c = (s) => data.filter((b) => b.status === s).length;
  $("#nNew").textContent = c("new") || "";
  $("#bkStats").innerHTML = [["new", "New"], ["negotiating", "In negotiation"], ["confirmed", "Confirmed"], ["completed", "Completed"], ["unsuccessful", "Unsuccessful"]]
    .map(([k, l]) => `<div class="stat"><b>${c(k)}</b><span class="muted">${l}</span></div>`).join("");
  renderBookings();
}
function renderBookings() {
  const f = $("#bkFilter").value, q = $("#bkSearch").value.trim().toLowerCase();
  const list = bookings.filter((b) =>
    (f === "all" || (f === "open" ? ["new", "negotiating"].includes(b.status) : b.status === f)) &&
    (!q || [b.artist_name, b.event, b.organization, b.promoter, b.city, b.country].join(" ").toLowerCase().includes(q)));
  $("#bkList").innerHTML = list.length ? list.map((b) => `
    <div class="list-item ${b.id === bkSel ? "sel" : ""}" data-id="${b.id}">
      <div><b>${esc(b.artist_name)}</b> · ${esc(b.event)}<div class="muted">${esc(b.city)} · ${esc(b.dates)} · ${b.floriqa_messages?.[0]?.count || 0} msg</div></div>
      <span class="badge ${SCLASS[b.status]}">${STATUS[b.status]}</span></div>`).join("") : `<p class="muted">No requests.</p>`;
  $$("#bkList .list-item").forEach((el) => el.addEventListener("click", () => showBooking(el.dataset.id)));
}
$("#bkFilter").addEventListener("change", renderBookings);
$("#bkSearch").addEventListener("input", renderBookings);
$("#bkRefresh").addEventListener("click", async () => { await loadBookings(); if (bkSel) showBooking(bkSel); });

const KIND = {
  promoter: ["Promoter", "", ""],
  manager: ["Manager", "sent to the promoter", "border-left:3px solid #d3ecf7"],
  artist: ["Artist note", "the promoter never sees it", "border-left:3px solid #f9e6b3;background:rgba(249,230,179,.08)"],
  note: ["Internal note", "artists, team and managers only", "border-left:3px solid #c9b6ff;background:rgba(201,182,255,.08)"],
};
const mailState = (m) => m.author_kind === "promoter" ? "received by e-mail" :
  m.email_status === "sent" ? "e-mail sent ✓" : m.email_status === "failed" ? "e-mail failed" : m.email_status === "pending" ? "e-mail pending" : "";

async function showBooking(id) {
  bkSel = id; renderBookings();
  const b = bookings.find((x) => x.id === id);
  if (!b) return;
  const artist = artists.find((a) => a.id === b.artist_id);
  const yn = (v, d) => (v ? `Yes${d ? " — " + esc(d) : ""}` : "No");
  const rows = [
    ["Received", fmtDate(b.created_at)], ["Artist", esc(b.artist_name)],
    ["Managers", managersOf(b.artist_id).length ? managersOf(b.artist_id).map(esc).join(", ") : `<span style="color:#ffb3ba">none — assign one in the artist's profile</span>`],
    ["Organisation", esc(b.organization)], ["Promoter", esc(b.promoter)],
    ["Phone", `<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`], ["E-mail", esc(b.email)],
    ["Event", esc(b.event)], ["Venue", esc(b.venue)], ["Date(s)", esc(b.dates)], ["Line-up", esc(b.lineup)],
    ["City / Country", `${esc(b.city)}, ${esc(b.country)}`],
    ["Social", b.social_link ? `<a target="_blank" rel="noopener" href="${esc(/^https?:/.test(b.social_link) ? b.social_link : "https://" + b.social_link)}">${esc(b.social_link)}</a>` : "—"],
    ["B2B", esc(b.b2b || "No")], ["Duration", esc(b.duration)], ["Time", esc(b.perf_time)], ["Net fee", `<b>${esc(b.fee)}${/^[0-9.,\s]+$/.test(b.fee || "") ? " €" : ""}</b>`],
    ["Transport", yn(b.transport, b.transport_details)], ["Accommodation", yn(b.accommodation, b.accommodation_details)], ["Hospitality", yn(b.hospitality, b.hospitality_details)],
  ];
  const { data: msgs } = await sb.from("floriqa_messages").select("*").eq("booking_id", id).order("created_at");
  const nego = canNegotiate(b.artist_id);
  const pk = artist?.floriqa_presskits;
  const pkLink = pk?.enabled ? `${SITE}presskit.html?k=${pk.token}` : null;

  $("#bkDetail").innerHTML = `
    <div class="toolbar"><h3 class="grow">${esc(b.artist_name)} · ${esc(b.event)}</h3><span class="badge ${SCLASS[b.status]}">${STATUS[b.status]}</span></div>
    <details><summary class="muted" style="cursor:pointer;margin-bottom:.6rem">Request details</summary><dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></details>
    <hr class="sep">
    <h3 style="margin-bottom:.6rem">Conversation</h3>
    <div class="comment"><div class="meta"><span><b>${esc(b.promoter)}</b> · Promoter · booking request</span><span>${fmtDate(b.created_at)}</span></div>
      <div class="body muted">Form submitted (see details above).</div></div>
    ${(msgs || []).map((m) => `
      <div class="comment" style="${KIND[m.author_kind][2]}">
        <div class="meta"><span><b>${esc(m.author_name || "")}</b> · ${KIND[m.author_kind][0]}${KIND[m.author_kind][1] ? ` <i>(${KIND[m.author_kind][1]})</i>` : ""}</span>
          <span>${fmtDate(m.created_at)} · ${mailState(m)}</span></div>
        <div class="body">${esc(m.body)}</div>
        ${m.email_status === "failed" ? `<div class="muted" style="color:#ffb3ba">${esc(m.email_error || "")}</div>` : ""}
      </div>`).join("")}
    <form id="msgForm" style="margin-top:.8rem">
      <label class="field"><span>Your message</span><textarea name="body" required placeholder="Write here, then choose who receives it…"></textarea></label>
      <div class="toolbar">
        ${nego ? `<button class="btn primary" type="button" data-send="promoter">Send to the promoter</button>` : ""}
        <button class="btn" type="button" data-send="note">Internal note</button>
        <span class="grow"></span>
        ${nego && pkLink ? `<button class="btn small" type="button" id="insertPk">Insert press-kit link</button>` : ""}
      </div>
      ${nego ? "" : `<p class="muted">${b.artist_id ? `Only this artist's managers answer the promoter${me.is_super ? ` (add <b>${MGMT}</b> to the artist to negotiate yourself)` : ""}.` : "Link an artist below to answer the promoter."} You can leave internal notes.</p>`}
    </form>
    <hr class="sep">
    <div class="row2">
      <label class="field"><span>Status</span>
        <select id="bkStatus">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === b.status ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${b.artist_id ? `<div class="field"><span>Artist</span><b style="padding:.55rem 0">${esc(artist?.name || b.artist_name)}</b></div>`
        : `<label class="field"><span>Link this request to an artist (not linked yet)</span>
        <select id="bkArtist"><option value="">—</option>${artists.filter((a) => myArtist(a.id)).map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></label>`}
    </div>
    <div class="toolbar"><button class="btn" id="bkSave">Save</button><span class="grow"></span>${me.is_super ? `<button class="btn danger" id="bkDel">Delete</button>` : ""}</div>`;

  const ta = $("#msgForm textarea");
  if (nego && pkLink) $("#insertPk").onclick = () => {
    ta.value = (ta.value ? ta.value + "\n\n" : "") + `Press kit ${b.artist_name}: ${pkLink}`; ta.focus();
  };
  $$("#msgForm [data-send]").forEach((btn) => btn.onclick = async () => {
    const body = ta.value.trim();
    if (!body) { ta.focus(); return toast("Write a message first.", "err"); }
    const toPromoter = btn.dataset.send === "promoter";
    const ok = await Floriqa.confirmBox(toPromoter ? {
      title: "⚠️ Message to the promoter",
      text: `Warning: this message will be sent by e-mail to the promoter <b>${esc(b.promoter)}</b> (${esc(b.email)}). The artist and their team will also see it in their panel.`,
      ok: "Send to the promoter",
    } : {
      title: "🔒 Private internal note",
      text: "You are sending a private message only to the artist, their team and the managers. <b>The promoter will never see it.</b>",
      ok: "Add internal note",
    }, body);
    if (!ok) return;
    $$("#msgForm [data-send]").forEach((x) => x.disabled = true);
    btn.textContent = "Sending…";
    const { data: m, error } = await sb.from("floriqa_messages").insert({
      booking_id: id, author_kind: toPromoter ? "manager" : "note", visibility: toPromoter ? "external" : "internal",
      author: user.id, author_name: me.display_name, body,
    }).select().single();
    if (error) { toast("Error: " + error.message, "err"); return showBooking(id); }
    const r = await mail({ type: "message", id: m.id });
    if (toPromoter) {
      if (b.status === "new") await sb.from("floriqa_bookings").update({ status: "negotiating" }).eq("id", id);
      toast(r?.ok ? "Reply sent to the promoter." : "Reply saved, but the e-mail failed.", r?.ok ? "ok" : "err");
      await loadBookings();
    } else toast("Internal note added.");
    showBooking(id);
  });
  $("#bkSave").onclick = async () => {
    const { error } = await sb.from("floriqa_bookings").update({ status: $("#bkStatus").value, ...($("#bkArtist") ? { artist_id: $("#bkArtist").value || null } : {}) }).eq("id", id);
    if (error) return toast("Could not save.", "err");
    toast("Saved."); await loadBookings(); showBooking(id);
  };
  if (me.is_super) $("#bkDel").onclick = async () => {
    if (!confirm("Permanently delete this request and its whole conversation?")) return;
    const { error } = await sb.from("floriqa_bookings").delete().eq("id", id);
    if (error) return toast("Could not delete.", "err");
    bkSel = null; $("#bkDetail").innerHTML = `<p class="muted">Deleted.</p>`; loadBookings();
  };
}

// =============== ARTISTS ===============
let artists = [], arSel = null;
async function loadArtists() {
  const { data, error } = await sb.from("floriqa_artists")
    .select("*, floriqa_tracks(*), floriqa_videos(*), floriqa_artist_photos(*), floriqa_presskits(*), floriqa_presskit_files(*), floriqa_contacts(*)").order("sort").order("name");
  if (error) return toast("Could not load artists.", "err");
  artists = data.filter((a) => myArtist(a.id)).map((a) => ({ ...a, floriqa_presskits: Array.isArray(a.floriqa_presskits) ? a.floriqa_presskits[0] : a.floriqa_presskits }));
  $("#arList").innerHTML = artists.map((a) => `
    <div class="list-item ${a.id === arSel ? "sel" : ""}" data-id="${a.id}">
      <div style="display:flex;gap:.7rem;align-items:center">
        ${(a.card_url || a.photo_url) ? `<img class="thumb" src="${esc(media(a.card_url || a.photo_url))}" alt="">` : `<div class="thumb"></div>`}
        <div><b>${esc(a.name)}</b><div class="muted">${esc(a.tagline || "")}${a.floriqa_contacts?.length ? "" : " · no contact"}${managersOf(a.id).length ? "" : " · no manager"}</div></div>
      </div>
      ${a.published ? "" : `<span class="badge">Hidden</span>`}
    </div>`).join("");
  $$("#arList .list-item").forEach((el) => el.addEventListener("click", () => showArtist(el.dataset.id)));
  if (arSel) showArtist(arSel);
  if (me.is_super) renderManagers();
}
const slugify = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const safeName = (n) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
const tooBig = (file) => { if (file.size > MAX) { toast(`"${file.name}" is larger than 50 MB.`, "err"); return true; } return false; };
async function uploadPublic(file, slug) {
  if (tooBig(file)) return null;
  const path = `artists/${slug}/${Date.now()}-${safeName(file.name)}`;
  const { error } = await sb.storage.from(PUB).upload(path, file, { contentType: file.type || undefined });
  if (error) { toast("Upload failed: " + error.message, "err"); return null; }
  return sb.storage.from(PUB).getPublicUrl(path).data.publicUrl;
}
async function removePublic(url) {
  const marker = `/storage/v1/object/public/${PUB}/`;
  if (url && url.includes(marker)) await sb.storage.from(PUB).remove([decodeURIComponent(url.split(marker)[1])]);
}
$("#arNew").addEventListener("click", () => { arSel = null; $$("#arList .list-item").forEach((x) => x.classList.remove("sel")); artistForm(null); });

function artistForm(a) {
  const isNew = !a;
  a = a || { name: "", slug: "", tagline: "", bio: "", published: true, sort: (artists.at(-1)?.sort || 0) + 1 };
  const by = (x, y) => x.sort - y.sort;
  const tracks = (a.floriqa_tracks || []).sort(by), vids = (a.floriqa_videos || []).sort(by), photos = (a.floriqa_artist_photos || []).sort(by);
  const contacts = (a.floriqa_contacts || []).sort((x, y) => x.kind.localeCompare(y.kind) || x.email.localeCompare(y.email));
  const pk = a.floriqa_presskits;
  const pkFiles = (a.floriqa_presskit_files || []).sort((x, y) => x.category.localeCompare(y.category) || x.sort - y.sort);
  const pkLink = pk ? `${SITE}presskit.html?k=${pk.token}` : "";
  const f = (k, label, type = "text", ph = "") => `<label class="field"><span>${label}</span><input type="${type}" name="${k}" value="${esc(a[k] || "")}" placeholder="${ph}"></label>`;
  const contactRow = (c) => `<div class="file-row" data-cid="${c.id}"><div><b>${esc(c.name || c.email)}</b> <span class="muted">${esc(c.email)}</span></div>
    <div class="actions"><button class="btn small danger" data-cdel>Remove</button></div></div>`;

  $("#arDetail").innerHTML = `
    <div class="toolbar"><h3 class="grow">${isNew ? "New artist" : esc(a.name)}</h3>
      ${isNew ? "" : `<a class="btn small" target="_blank" href="../artist.html?a=${esc(a.slug)}">View public page ↗</a>
        <a class="btn small" target="_blank" rel="noopener" href="${esc(Floriqa.bookingUrl(a.name))}">Booking form ↗</a>
        <button class="btn small" type="button" id="arBookCopy">Copy booking link</button>`}</div>
    <form id="arForm">
      <div class="row2">
        <label class="field"><span>Name (solo, duo, trio, band…)</span><input type="text" name="name" required value="${esc(a.name)}"></label>
        <label class="field"><span>Page address (e.g. kolok)</span><input type="text" name="slug" required pattern="[a-z0-9-]+" value="${esc(a.slug)}"></label>
      </div>
      ${f("tagline", "Tagline (e.g. DJ & Producer)")}
      <label class="field"><span>Biography</span><textarea name="bio" style="min-height:140px">${esc(a.bio || "")}</textarea></label>
      <div class="row2">${f("instagram", "Instagram", "url")}${f("spotify", "Spotify", "url")}</div>
      <div class="row2">${f("soundcloud", "SoundCloud", "url")}${f("youtube", "YouTube", "url")}</div>
      <div class="row2">${f("website", "Website", "url")}
        <div class="row2">
          <label class="field"><span>Order</span><input type="number" name="sort" value="${a.sort}"></label>
          <label class="field"><span>Visible on the site</span><select name="published"><option value="1" ${a.published ? "selected" : ""}>Yes</option><option value="0" ${a.published ? "" : "selected"}>No (hidden)</option></select></label>
        </div></div>
      <div class="toolbar"><button class="btn primary" type="submit">${isNew ? "Create artist" : "Save"}</button>
        <span class="grow"></span>${isNew || !me.is_super ? "" : `<button class="btn danger" type="button" id="arDel">Delete artist</button>`}</div>
    </form>
    ${isNew ? "" : `
    <hr class="sep">
    <h3>Managers</h3>
    <p class="muted" style="margin:.3rem 0 .8rem">They see this artist's bookings, answer the promoter, edit this page, approve page requests and get the e-mail alerts.</p>
    ${me.is_super ? `<div id="mgPick" style="display:flex;flex-wrap:wrap;gap:.4rem 1.2rem">${managers.map((m) => `
      <label style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" value="${esc(m.email)}" ${managersOf(a.id).includes(m.email) ? "checked" : ""}>
        <span>${esc(m.display_name || m.email)} <span class="muted">${esc(m.email)}</span></span></label>`).join("") || `<span class="muted">No manager address yet — create one in the Admins tab.</span>`}</div>
      ${managers.length ? `<button class="btn small" id="mgSave" style="margin-top:.6rem">Save managers</button>` : ""}`
    : `<p>${managersOf(a.id).map(esc).join(", ") || "—"}</p>`}
    <hr class="sep">
    <h3>Contacts — Artists panel access</h3>
    <p class="muted" style="margin:.3rem 0 .8rem">They sign in at <b>${esc(SITE)}panel/</b> with this e-mail. <b>Artists</b> (the members of the project) see bookings, the artist page and rooms. <b>Team</b> sees bookings and the artist page only — never rooms.</p>
    <h4 style="margin-bottom:.4rem">Artists / members</h4>
    <div>${contacts.filter((c) => c.kind === "member").map(contactRow).join("") || `<p class="muted">No artist e-mail yet.</p>`}</div>
    <h4 style="margin:.8rem 0 .4rem">Team</h4>
    <div>${contacts.filter((c) => c.kind === "team").map(contactRow).join("") || `<p class="muted">No team member.</p>`}</div>
    <form id="ctForm" class="toolbar" style="margin-top:.6rem">
      <input type="email" name="email" required placeholder="e-mail" style="max-width:240px">
      <input type="text" name="name" placeholder="Name" style="max-width:170px">
      <select name="kind" style="width:auto"><option value="member">Artist / member</option><option value="team">Team</option></select>
      <button class="btn" type="submit">Add contact</button>
    </form>
    <p class="muted">Team page changes need approval from: <b>${a.edit_approval === "none" ? "nobody" : a.edit_approval === "selected" ? esc((a.edit_approvers || []).join(", ")) : a.edit_approval === "all" ? "all artists" : "one artist"}</b> (set by the artists in their settings).</p>

    <hr class="sep">
    <h3>Photos</h3>
    <div class="row2" style="margin-top:.6rem">
      <div class="field"><span>Square photo (artists list)</span>${a.card_url ? `<img class="thumb" style="width:90px;height:90px;margin-bottom:.4rem" src="${esc(media(a.card_url))}">` : ""}<input type="file" accept="image/*" data-up="card_url"></div>
      <div class="field"><span>Main page photo</span>${a.photo_url ? `<img class="thumb" style="width:90px;height:90px;margin-bottom:.4rem" src="${esc(media(a.photo_url))}">` : ""}<input type="file" accept="image/*" data-up="photo_url"></div>
    </div>
    <div class="field"><span>Gallery</span>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem">${photos.map((p) => `
        <div style="position:relative"><img class="thumb" style="width:90px;height:90px" src="${esc(media(p.url))}">
          <button class="btn small danger" data-phdel="${p.id}" style="position:absolute;top:2px;right:2px;padding:.1rem .4rem">×</button></div>`).join("") || `<span class="muted">No photos.</span>`}</div>
      <input type="file" accept="image/*" multiple id="galFile"></div>

    <hr class="sep">
    <h3>Tracks</h3>
    <div id="trList" style="margin:.8rem 0">${tracks.map((t) => `
      <div class="file-row" data-id="${t.id}"><input type="text" value="${esc(t.title)}" data-title>
        <div class="actions"><button class="btn small" data-save>Rename</button><button class="btn small danger" data-del>Remove</button></div>
        <audio controls preload="none" src="${esc(media(t.audio_url))}"></audio></div>`).join("") || `<p class="muted">No tracks.</p>`}</div>
    <div class="toolbar"><input type="text" id="trTitle" placeholder="Track title" class="grow" style="max-width:300px"><input type="file" id="trFile" accept="audio/*"><button class="btn" id="trAdd">Add track</button></div>

    <hr class="sep">
    <h3>Videos</h3>
    <div id="viList" style="margin:.8rem 0">${vids.map((v) => `
      <div class="file-row" data-id="${v.id}"><div>${esc(v.title || "Video")} <span class="muted">· ${v.vertical ? "vertical" : "horizontal"}</span></div>
      <div class="actions"><a class="btn small" target="_blank" href="${esc(media(v.video_url))}">View</a><button class="btn small danger" data-del>Remove</button></div></div>`).join("") || `<p class="muted">No videos.</p>`}</div>
    <div class="toolbar"><input type="text" id="viTitle" placeholder="Title" style="max-width:200px">
      <select id="viVert" style="max-width:160px"><option value="0">Horizontal</option><option value="1">Vertical</option></select>
      <input type="file" id="viFile" accept="video/mp4,video/*"><button class="btn" id="viAdd">Add video</button></div>
    <p class="muted">50 MB max per file.</p>

    <hr class="sep">
    <h3>🔒 Private link (press kit for promoters)</h3>
    <p class="muted" style="margin:.3rem 0 .8rem">Secret page: only people with the link can open it.</p>
    ${pk ? `
      <div class="toolbar"><input type="text" readonly value="${esc(pkLink)}" id="pkLink" class="grow" style="max-width:520px">
        <button class="btn small" id="pkCopy">Copy</button><a class="btn small" target="_blank" href="${esc(pkLink)}">Open ↗</a></div>
      <div class="toolbar"><span class="badge ${pk.enabled ? "accepted" : "declined"}">${pk.enabled ? "Active" : "Disabled"}</span>
        <button class="btn small" id="pkToggle">${pk.enabled ? "Disable link" : "Enable link"}</button>
        <button class="btn small danger" id="pkRegen">New link (old one stops working)</button></div>
      <label class="field"><span>Message at the top of the private page (optional)</span><textarea id="pkMsg" style="min-height:60px">${esc(pk.message || "")}</textarea></label>
      <button class="btn small" id="pkMsgSave">Save message</button>
      <h4 style="margin:1.2rem 0 .6rem">Private files</h4>
      <div id="pkList">${pkFiles.map((x) => `
        <div class="file-row" data-id="${x.id}"><div><b>${esc(x.name)}</b> <span class="muted">· ${PKCAT[x.category]} · ${fmtSize(x.size_bytes)}</span></div>
          <div class="actions"><button class="btn small" data-dl>Download</button><button class="btn small danger" data-del>×</button></div></div>`).join("") || `<p class="muted">No private files.</p>`}</div>
      <div class="toolbar" style="margin-top:.6rem"><select id="pkCat" style="width:auto">${Object.entries(PKCAT).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
        <input type="file" id="pkFile" multiple><button class="btn" id="pkAdd">Add</button></div>
      <div class="progress hidden" id="pkProg"><i></i></div>`
    : `<button class="btn primary" id="pkCreate">Create private link</button>`}
    `}`;

  const form = $("#arForm");
  form.name.addEventListener("input", () => { if (isNew) form.slug.value = slugify(form.name.value); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const g = (k) => (fd.get(k) || "").toString().trim() || null;
    const row = { name: g("name"), slug: slugify(g("slug") || ""), tagline: g("tagline"), bio: g("bio"),
      instagram: g("instagram"), spotify: g("spotify"), soundcloud: g("soundcloud"), youtube: g("youtube"), website: g("website"),
      sort: +fd.get("sort") || 0, published: fd.get("published") === "1" };
    const q = isNew ? sb.from("floriqa_artists").insert(row).select().single() : sb.from("floriqa_artists").update(row).eq("id", a.id).select().single();
    const { data, error } = await q;
    if (error) return toast(error.code === "23505" ? "This page address already exists." : "Error: " + error.message, "err");
    toast(isNew ? "Artist created. Now add contacts, photos and tracks." : "Saved.");
    arSel = data.id; loadArtists();
  });
  if (isNew) return;
  $("#arBookCopy").onclick = () => Floriqa.copyText(Floriqa.bookingUrl(a.name));

  if ($("#mgSave")) $("#mgSave").onclick = async () => {
    const want = $$("#mgPick input:checked").map((x) => x.value), have = managersOf(a.id);
    const add = want.filter((x) => !have.includes(x)), del = have.filter((x) => !want.includes(x));
    if (del.length) { const { error } = await sb.from("floriqa_artist_managers").delete().eq("artist_id", a.id).in("manager_email", del); if (error) return toast("Error: " + error.message, "err"); }
    if (add.length) { const { error } = await sb.from("floriqa_artist_managers").insert(add.map((m) => ({ artist_id: a.id, manager_email: m }))); if (error) return toast("Error: " + error.message, "err"); }
    toast("Managers saved."); await loadManagers(); loadArtists();
  };
  $("#ctForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const { error } = await sb.from("floriqa_contacts").insert({ artist_id: a.id, email: fd.get("email").trim().toLowerCase(), name: fd.get("name").trim() || null, kind: fd.get("kind") });
    if (error) return toast(error.code === "23505" ? "This e-mail is already on this artist." : "Error: " + error.message, "err");
    toast("Contact added."); loadArtists();
  };
  $$("[data-cid]").forEach((row) => $("[data-cdel]", row).onclick = async () => {
    if (!confirm("Remove this contact? They will lose access to this artist in the Artists panel.")) return;
    await sb.from("floriqa_contacts").delete().eq("id", row.dataset.cid); loadArtists();
  });
  $$("[data-up]").forEach((inp) => inp.addEventListener("change", async () => {
    let file = inp.files[0]; inp.value = ""; if (!file) return;
    file = await Floriqa.cropImage(file, { aspect: 1, title: inp.dataset.up === "card_url" ? "Crop — square photo (artists list)" : "Crop — main page photo" });
    if (!file) return;
    toast("Uploading…");
    const url = await uploadPublic(file, a.slug); if (!url) return;
    const old = a[inp.dataset.up];
    const { error } = await sb.from("floriqa_artists").update({ [inp.dataset.up]: url }).eq("id", a.id);
    if (error) return toast("Error: " + error.message, "err");
    await removePublic(old); toast("Photo updated."); loadArtists();
  }));
  $("#galFile").addEventListener("change", async (e) => {
    const files = [...e.target.files]; if (!files.length) return;
    toast(`Uploading ${files.length} photo(s)…`);
    let n = photos.at(-1)?.sort || 0;
    for (const file of files) { const url = await uploadPublic(file, a.slug); if (url) await sb.from("floriqa_artist_photos").insert({ artist_id: a.id, url, sort: ++n }); }
    toast("Gallery updated."); loadArtists();
  });
  $$("[data-phdel]").forEach((b) => b.onclick = async () => {
    const p = photos.find((x) => x.id === b.dataset.phdel);
    await sb.from("floriqa_artist_photos").delete().eq("id", p.id); await removePublic(p.url); loadArtists();
  });
  if ($("#arDel")) $("#arDel").onclick = async () => {
    if (!confirm(`Delete ${a.name} with all tracks, videos, photos, contacts and private files? This cannot be undone.`)) return;
    const paths = pkFiles.map((x) => x.storage_path);
    const { error } = await sb.from("floriqa_artists").delete().eq("id", a.id);
    if (error) return toast("Error: " + error.message, "err");
    for (const u of [a.card_url, a.photo_url, ...tracks.map((t) => t.audio_url), ...vids.map((v) => v.video_url), ...photos.map((p) => p.url)]) await removePublic(u);
    if (paths.length) await sb.storage.from(PK).remove(paths);
    arSel = null; $("#arDetail").innerHTML = `<p class="muted">Artist deleted.</p>`; loadArtists();
  };
  $$("#trList .file-row").forEach((row) => {
    const t = tracks.find((x) => x.id === row.dataset.id);
    $("[data-save]", row).onclick = async () => {
      const { error } = await sb.from("floriqa_tracks").update({ title: $("[data-title]", row).value }).eq("id", t.id);
      toast(error ? "Error." : "Saved.", error ? "err" : "ok");
    };
    $("[data-del]", row).onclick = async () => {
      if (!confirm(`Remove "${t.title}"?`)) return;
      await sb.from("floriqa_tracks").delete().eq("id", t.id); await removePublic(t.audio_url); loadArtists();
    };
  });
  $$("#viList .file-row").forEach((row) => {
    const v = vids.find((x) => x.id === row.dataset.id);
    $("[data-del]", row).onclick = async () => {
      if (!confirm("Remove this video?")) return;
      await sb.from("floriqa_videos").delete().eq("id", v.id); await removePublic(v.video_url); loadArtists();
    };
  });
  $("#trAdd").onclick = async (e) => {
    const file = $("#trFile").files[0]; const title = $("#trTitle").value.trim() || file?.name.replace(/\.[^.]+$/, "");
    if (!file) return toast("Choose an audio file.", "err");
    e.target.disabled = true; e.target.textContent = "Uploading…";
    const url = await uploadPublic(file, a.slug);
    if (url) { const { error } = await sb.from("floriqa_tracks").insert({ artist_id: a.id, title, audio_url: url, sort: (tracks.at(-1)?.sort || 0) + 1 }); toast(error ? "Error: " + error.message : "Track added.", error ? "err" : "ok"); }
    loadArtists();
  };
  $("#viAdd").onclick = async (e) => {
    const file = $("#viFile").files[0];
    if (!file) return toast("Choose a video file.", "err");
    e.target.disabled = true; e.target.textContent = "Uploading…";
    const url = await uploadPublic(file, a.slug);
    if (url) { const { error } = await sb.from("floriqa_videos").insert({ artist_id: a.id, title: $("#viTitle").value || null, video_url: url, vertical: $("#viVert").value === "1", sort: (vids.at(-1)?.sort || 0) + 1 }); toast(error ? "Error: " + error.message : "Video added.", error ? "err" : "ok"); }
    loadArtists();
  };

  const newToken = () => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  if (!pk) {
    $("#pkCreate").onclick = async () => {
      const { error } = await sb.from("floriqa_presskits").insert({ artist_id: a.id, token: newToken() });
      toast(error ? "Error: " + error.message : "Private link created.", error ? "err" : "ok"); loadArtists();
    };
    return;
  }
  $("#pkCopy").onclick = async () => { await navigator.clipboard.writeText(pkLink).catch(() => $("#pkLink").select()); toast("Link copied."); };
  $("#pkToggle").onclick = async () => { await sb.from("floriqa_presskits").update({ enabled: !pk.enabled, updated_at: new Date().toISOString() }).eq("artist_id", a.id); loadArtists(); };
  $("#pkRegen").onclick = async () => {
    if (!confirm("Create a new link? The old link will stop working for everyone.")) return;
    await sb.from("floriqa_presskits").update({ token: newToken(), updated_at: new Date().toISOString() }).eq("artist_id", a.id); toast("New link created."); loadArtists();
  };
  $("#pkMsgSave").onclick = async () => { await sb.from("floriqa_presskits").update({ message: $("#pkMsg").value.trim() || null }).eq("artist_id", a.id); toast("Message saved."); };
  $$("#pkList .file-row").forEach((row) => {
    const x = pkFiles.find((y) => y.id === row.dataset.id);
    $("[data-dl]", row).onclick = async () => { const { data } = await sb.storage.from(PK).createSignedUrl(x.storage_path, 600, { download: x.name }); if (data) location.href = data.signedUrl; };
    $("[data-del]", row).onclick = async () => {
      if (!confirm(`Remove "${x.name}"?`)) return;
      await sb.storage.from(PK).remove([x.storage_path]); await sb.from("floriqa_presskit_files").delete().eq("id", x.id); loadArtists();
    };
  });
  $("#pkAdd").onclick = async () => {
    const files = [...$("#pkFile").files].filter((x) => !tooBig(x));
    if (!files.length) return toast("Choose one or more files.", "err");
    const cat = $("#pkCat").value, bar = $("#pkProg i"); $("#pkProg").classList.remove("hidden");
    let done = 0;
    for (const file of files) {
      bar.style.width = Math.round((done / files.length) * 100) + 5 + "%";
      const path = `${a.id}/${crypto.randomUUID()}-${safeName(file.name)}`;
      const { error } = await sb.storage.from(PK).upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (error) { toast(`Upload failed for "${file.name}": ${error.message}`, "err"); continue; }
      await sb.from("floriqa_presskit_files").insert({ artist_id: a.id, category: cat, name: file.name, storage_path: path, size_bytes: file.size, sort: ++done });
    }
    toast(`${done} file(s) added.`); loadArtists();
  };
}
function showArtist(id) {
  arSel = id;
  $$("#arList .list-item").forEach((x) => x.classList.toggle("sel", x.dataset.id === id));
  artistForm(artists.find((a) => a.id === id));
}

// =============== PAGE REQUESTS ===============
const FIELDS = [["tagline", "Tagline"], ["bio", "Biography"], ["instagram", "Instagram"], ["spotify", "Spotify"], ["soundcloud", "SoundCloud"], ["youtube", "YouTube"], ["website", "Website"], ["photo_url", "Main photo"], ["card_url", "Square photo"], ["gallery", "Gallery"]];
const RSTATUS = { awaiting_artists: "Waiting for artists", pending_admin: "Waiting for you", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" };
const RCLASS = { awaiting_artists: "new", pending_admin: "in_progress", approved: "accepted", rejected: "declined", cancelled: "archived" };
const showVal = (k, v) => {
  if (k === "gallery") return (v || []).length ? `<div class="gal">${v.map((u) => `<img src="${esc(media(u))}">`).join("")}</div>` : "—";
  if (k === "photo_url" || k === "card_url") return v ? `<img src="${esc(media(v))}" style="width:70px;height:70px;object-fit:cover;border-radius:8px">` : "—";
  return v ? `<span style="white-space:pre-wrap">${esc(v)}</span>` : "—";
};
let requests = [];
async function loadRequests() {
  const { data } = await sb.from("floriqa_profile_requests").select("*, floriqa_artists(name)").order("created_at", { ascending: false }).limit(200);
  requests = data || [];
  $("#nReq").textContent = requests.filter((r) => r.status === "pending_admin").length || "";
  renderRequests();
}
function renderRequests() {
  const f = $("#rqFilter").value;
  const list = requests.filter((r) => f === "all" || r.status === f);
  $("#rqList").innerHTML = list.length ? list.map((r) => `
    <div class="list-item" data-id="${r.id}"><div><b>${esc(r.floriqa_artists?.name || "")}</b><div class="muted">${fmtDate(r.created_at)} · ${Object.keys(r.proposed).length} change(s)</div></div>
      <span class="badge ${RCLASS[r.status]}">${RSTATUS[r.status]}</span></div>`).join("") : `<p class="muted">Nothing here.</p>`;
  $$("#rqList .list-item").forEach((el) => el.onclick = () => showRequest(el.dataset.id));
}
$("#rqFilter").onchange = renderRequests;
function showRequest(id) {
  const r = requests.find((x) => x.id === id);
  const full = { ...r.previous, ...r.proposed };
  $("#rqDetail").innerHTML = `
    <div class="toolbar"><h3 class="grow">${esc(r.floriqa_artists?.name || "")} — page change request</h3><span class="badge ${RCLASS[r.status]}">${RSTATUS[r.status]}</span></div>
    <p class="muted">Requested ${fmtDate(r.created_at)} by ${esc(r.requested_email || "")} (${r.requester_kind === "team" ? "team" : "artist"})${r.approvals?.length ? ` · approved by ${r.approvals.map(esc).join(", ")}` : ""}</p>
    <h4 style="margin:1rem 0 .4rem">What changed</h4>
    <table class="diff" style="width:100%"><tr><th>Field</th><th>Old version</th><th>New version</th></tr>
      ${Object.keys(r.proposed).map((k) => `<tr><td>${FIELDS.find((f) => f[0] === k)?.[1] || k}</td><td>${showVal(k, r.previous[k])}</td><td>${showVal(k, r.proposed[k])}</td></tr>`).join("")}</table>
    <h4 style="margin:1.2rem 0 .4rem">Full new page</h4>
    <table class="diff" style="width:100%">${FIELDS.map(([k, l]) => `<tr><td>${l}</td><td>${showVal(k, full[k])}</td></tr>`).join("")}</table>
    ${r.status === "pending_admin" ? `
      <label class="field" style="margin-top:1rem"><span>Note to the artist (optional)</span><input type="text" id="rqNote"></label>
      <div class="toolbar"><button class="btn primary" id="rqOk">Approve & publish</button><button class="btn danger" id="rqNo">Reject</button></div>`
    : r.admin_note ? `<p class="muted" style="margin-top:1rem">Note: ${esc(r.admin_note)}</p>` : ""}`;
  if (r.status !== "pending_admin") return;
  const decide = async (ok) => {
    const { error } = await sb.rpc("floriqa_decide_request", { p_id: id, p_approve: ok, p_note: $("#rqNote").value.trim() || null });
    if (error) return toast("Error: " + error.message, "err");
    toast(ok ? "Approved — the page is updated." : "Request rejected.");
    await loadRequests(); showRequest(id); if (ok) loadArtists();
  };
  $("#rqOk").onclick = () => decide(true);
  $("#rqNo").onclick = () => decide(false);
}

// =============== MANAGER ADDRESSES ===============
async function loadManagers() {
  const [{ data: ms }, { data: ls }] = await Promise.all([
    sb.from("floriqa_managers").select("*").order("is_super", { ascending: false }).order("email"),
    sb.from("floriqa_artist_managers").select("*"),
  ]);
  managers = ms || []; links = ls || [];
  if (me.is_super) renderManagers();
}
const adminCall = async (payload) => {
  const { data, error } = await sb.functions.invoke("floriqa-admin", { body: payload });
  if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch {} return { error: msg }; }
  return data;
};
function renderManagers() {
  const nameOf = (id) => artists.find((a) => a.id === id)?.name || "?";
  $("#mgList").innerHTML = managers.map((m) => `
    <div class="file-row" data-mg="${esc(m.email)}" style="flex-wrap:wrap">
      <div><b>${esc(m.email)}</b>${m.is_super ? ` <span class="badge accepted">full access</span>` : ""}
        <div class="muted">${esc(m.display_name || "")} · alerts → ${m.forward_email ? esc(m.forward_email) : `<span style="color:#ffb3ba">no forwarding e-mail</span>`}</div>
        <div class="muted">Artists: ${links.filter((l) => l.manager_email === m.email).map((l) => esc(nameOf(l.artist_id))).join(", ") || "none"}</div></div>
      <div class="actions"><button class="btn small" data-edit>Edit / reassign</button>${m.is_super ? "" : `<button class="btn small danger" data-del>Delete</button>`}</div>
      <form class="hidden" data-form style="flex-basis:100%;margin-top:.6rem">
        <div class="row2">
          <label class="field"><span>Name shown to promoters</span><input type="text" name="display_name" value="${esc(m.display_name || "")}"></label>
          <label class="field"><span>Forwarding e-mail (receives the alerts)</span><input type="email" name="forward_email" value="${esc(m.forward_email || "")}" placeholder="name@gmail.com"></label>
        </div>
        <div class="row2">
          <label class="field"><span>New password (leave empty to keep it)</span><input type="password" name="pw" minlength="8" autocomplete="new-password"></label>
          <label class="field"><span>Confirm new password</span><input type="password" name="pw2" minlength="8" autocomplete="new-password"></label>
        </div>
        <p class="muted" style="margin-bottom:.6rem">Changing the password signs out whoever is using this address. Give the new password to the new manager.</p>
        <button class="btn primary" type="submit">Save</button>
      </form>
    </div>`).join("") || `<p class="muted">No manager address yet.</p>`;
  $$("#mgList [data-mg]").forEach((row) => {
    const email = row.dataset.mg, form = $("[data-form]", row);
    $("[data-edit]", row).onclick = () => form.classList.toggle("hidden");
    const del = $("[data-del]", row);
    if (del) del.onclick = async () => {
      if (!confirm(`Delete ${email}? The account is closed and removed from all its artists.`)) return;
      const r = await adminCall({ action: "delete", email });
      if (r.error) return toast(r.error, "err");
      toast("Address deleted."); await loadManagers(); loadArtists();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      if (fd.get("pw") !== fd.get("pw2")) return toast("The two passwords don't match.", "err");
      const payload = { action: "update", email, display_name: fd.get("display_name"), forward_email: fd.get("forward_email") || null };
      if (fd.get("pw")) payload.password = fd.get("pw");
      const r = await adminCall(payload);
      if (r.error) return toast(r.error, "err");
      toast(payload.password ? "Saved. The new password is active; old sessions are signed out." : "Saved.");
      loadManagers();
    };
  });
}
$("#mgForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (fd.get("pw") !== fd.get("pw2")) return toast("The two passwords don't match.", "err");
  const btn = $("button[type=submit]", e.target); btn.disabled = true;
  const r = await adminCall({ action: "create", local: fd.get("local"), display_name: fd.get("display_name"), password: fd.get("pw"),
    forward_email: fd.get("forward_email") || null, is_super: fd.get("is_super") === "1" });
  btn.disabled = false;
  if (r.error) return toast(r.error, "err");
  e.target.reset(); toast(`${r.email} created. Assign it to artists in the Artists tab.`); loadManagers();
});

// =============== ADMINS ===============
$("#invForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const { error } = await sb.from("floriqa_invites").upsert({ email: f.get("email").trim().toLowerCase(), display_name: f.get("name").trim() || null, role: "admin" });
  if (error) return toast("Error: " + error.message, "err");
  e.target.reset(); toast("Admin added. They can now sign in."); loadAdmins();
});
async function loadAdmins() {
  const [{ data: invs }, { data: mems }] = await Promise.all([
    sb.from("floriqa_invites").select("*").eq("role", "admin").order("created_at"),
    sb.from("floriqa_members").select("*").eq("role", "admin").order("display_name"),
  ]);
  $("#invList").innerHTML = invs?.length ? `<p class="muted" style="margin:.8rem 0 .4rem">Not signed in yet:</p>` + invs.map((i) => `
    <div class="file-row" data-id="${esc(i.email)}"><div><b>${esc(i.display_name || i.email)}</b> <span class="muted">${esc(i.email)}</span></div>
      <div class="actions"><button class="btn small danger" data-del>Cancel</button></div></div>`).join("") : "";
  $$("#invList .file-row").forEach((row) => $("[data-del]", row).onclick = async () => { await sb.from("floriqa_invites").delete().eq("email", row.dataset.id); loadAdmins(); });
  $("#admList").innerHTML = (mems || []).map((m) => `
    <div class="file-row" data-id="${m.user_id}"><div><b>${esc(m.display_name)}</b> <span class="muted">${esc(m.email || "")}</span></div>
      <div class="actions">${m.user_id === me.user_id ? `<span class="muted">you</span>` : `<button class="btn small danger" data-del>Remove admin</button>`}</div></div>`).join("");
  $$("#admList .file-row").forEach((row) => { const d = $("[data-del]", row); if (d) d.onclick = async () => {
    if (!confirm("Remove this admin?")) return;
    await sb.from("floriqa_members").delete().eq("user_id", row.dataset.id); loadAdmins();
  }; });
}

boot();
