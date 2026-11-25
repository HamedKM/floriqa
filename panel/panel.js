// Floriqa — Artists panel (bookings, artist page edit requests, rooms)
const { sb, esc, media, buildChrome, toast, fmtDate, fmtSize, mail, authFlow } = Floriqa;
buildChrome({ video: false });

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const MAX = 50 * 1024 * 1024;
const ROOM_BUCKET = "floriqa-room";
const PUB = "floriqa-public";
const safeName = (n) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
const AUDIO = /\.(mp3|wav|aiff?|flac|m4a|ogg|aac)$/i;
const DAW = /\.(als|alp|logicx|flp|ptx|rpp|cpr|song|bwproject|zip|rar|7z)$/i;
const kindOf = (n) => (AUDIO.test(n) ? "audio" : DAW.test(n) ? "daw" : "other");
const KIND = { audio: "🎧 Audio", daw: "🎛️ Project", other: "📎 File" };

let me = null, user = null, artist = null; // artist = currently selected {id,name,kind,...}

// ---------- sign-in ----------
$("#logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session || session.user.is_anonymous) {
    $("#auth").classList.remove("hidden"); $("#app").classList.add("hidden");
    return authFlow($("#auth"), { title: "Floriqa · Artists panel", onDone: boot });
  }
  user = session.user;
  await sb.rpc("floriqa_claim_invite");
  const { data } = await sb.rpc("floriqa_whoami");
  me = data || { artists: [] };
  if (!me.artists.length && !me.is_admin) {
    $("#auth").classList.remove("hidden");
    $("#auth").innerHTML = `<h2>No access</h2><p class="muted" style="margin:.6rem 0 1rem">${esc(user.email)} is not linked to any Floriqa artist.</p><button class="btn" id="lo">Sign out</button>`;
    $("#lo").onclick = async () => { await sb.auth.signOut(); location.reload(); };
    return;
  }
  $("#auth").classList.add("hidden"); $("#app").classList.remove("hidden");
  $("#adminLink").classList.toggle("hidden", !me.is_admin);
  const sw = $("#artistSwitch");
  sw.innerHTML = me.artists.map((a, i) => `<option value="${i}">${esc(a.name)}${a.kind === "team" ? " (team)" : ""}</option>`).join("");
  sw.classList.toggle("hidden", me.artists.length < 2);
  const saved = +sessionStorage.getItem("flq-artist") || 0;
  sw.value = me.artists[saved] ? saved : 0;
  sw.onchange = () => { sessionStorage.setItem("flq-artist", sw.value); selectArtist(); };
  selectArtist();
}

function selectArtist() {
  artist = me.artists[+$("#artistSwitch").value] || null;
  const isMember = artist?.kind === "member";
  $("#who").textContent = artist ? `${artist.person} · ${artist.kind === "member" ? "Artist" : "Team"}` : (me.admin_name || me.email) + " · Admin";
  // tabs: team = bookings + page ; artists = all ; admin without artist = rooms
  const tabs = { bookings: !!artist, page: !!artist, rooms: isMember || me.is_admin };
  $$("#mainTabs .tab").forEach((t) => t.classList.toggle("hidden", !tabs[t.dataset.tab]));
  const first = Object.keys(tabs).find((k) => tabs[k]);
  openTab($("#mainTabs .tab.active:not(.hidden)")?.dataset.tab || first);
}
$$("#mainTabs .tab").forEach((t) => t.addEventListener("click", () => openTab(t.dataset.tab)));
function openTab(name) {
  $$("#mainTabs .tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === name));
  $$("[data-pane]").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== name));
  if (name === "bookings") loadBookings();
  if (name === "page") loadPage();
  if (name === "rooms") loadRooms();
}

// =============== BOOKINGS ===============
const GROUPS = [
  ["negotiating", "In negotiation", ["new", "negotiating"]],
  ["confirmed", "Confirmed", ["confirmed"]],
  ["completed", "Completed", ["completed"]],
  ["cancelled", "Cancelled", ["cancelled"]],
  ["unsuccessful", "Unsuccessful", ["unsuccessful"]],
];
const SLABEL = { new: "New", negotiating: "In negotiation", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled", unsuccessful: "Unsuccessful" };
const SCLASS = { new: "new", negotiating: "in_progress", confirmed: "accepted", completed: "archived", cancelled: "declined", unsuccessful: "declined" };
let bookings = [], bkGroup = "negotiating", bkSel = null;

async function loadBookings() {
  const { data } = await sb.from("floriqa_bookings")
    .select("id,created_at,status,artist_name,promoter,organization,event,venue,dates,city,country,fee,duration,perf_time,b2b,lineup,transport,transport_details,accommodation,accommodation_details,hospitality,hospitality_details, floriqa_messages(count)")
    .eq("artist_id", artist.id).order("created_at", { ascending: false });
  bookings = data || [];
  renderBkTabs(); renderBookings();
}
function renderBkTabs() {
  $("#bkTabs").innerHTML = GROUPS.map(([k, l, st]) => {
    const n = bookings.filter((b) => st.includes(b.status)).length;
    return `<button class="tab ${k === bkGroup ? "active" : ""}" data-g="${k}">${l}${n ? ` (${n})` : ""}</button>`;
  }).join("");
  $$("#bkTabs .tab").forEach((t) => t.onclick = () => { bkGroup = t.dataset.g; bkSel = null; renderBkTabs(); renderBookings(); $("#bkView").innerHTML = `<p class="muted">Select a booking.</p>`; });
}
function renderBookings() {
  const st = GROUPS.find((g) => g[0] === bkGroup)[2];
  const list = bookings.filter((b) => st.includes(b.status));
  $("#bkList").innerHTML = list.length ? list.map((b) => `
    <div class="list-item ${b.id === bkSel ? "sel" : ""}" data-id="${b.id}">
      <div><b>${esc(b.event)}</b><div class="muted">${esc(b.city)} · ${esc(b.dates)} · ${b.floriqa_messages?.[0]?.count || 0} msg</div></div>
      <span class="badge ${SCLASS[b.status]}">${SLABEL[b.status]}</span></div>`).join("") : `<p class="muted">Nothing here.</p>`;
  $$("#bkList .list-item").forEach((el) => el.onclick = () => openBooking(el.dataset.id));
}
async function openBooking(id) {
  bkSel = id; renderBookings();
  const b = bookings.find((x) => x.id === id);
  const { data: msgs } = await sb.from("floriqa_messages").select("*").eq("booking_id", id).order("created_at");
  const yn = (v, d) => (v ? `Yes${d ? " — " + esc(d) : ""}` : "No");
  const LBL = { promoter: "Promoter", manager: "Manager", artist: "Internal note to the manager" };
  $("#bkView").innerHTML = `
    <div class="toolbar"><h3 class="grow">${esc(b.event)}</h3><span class="badge ${SCLASS[b.status]}">${SLABEL[b.status]}</span></div>
    <details><summary class="muted" style="cursor:pointer;margin-bottom:.6rem">Request details</summary>
      <dl class="kv">
        <dt>Promoter</dt><dd>${esc(b.promoter)} — ${esc(b.organization)}</dd>
        <dt>Venue</dt><dd>${esc(b.venue)}, ${esc(b.city)} (${esc(b.country)})</dd>
        <dt>Date(s)</dt><dd>${esc(b.dates)} · ${esc(b.perf_time)} · ${esc(b.duration)} h</dd>
        <dt>Line-up</dt><dd>${esc(b.lineup || "—")}${b.b2b ? ` · B2B ${esc(b.b2b)}` : ""}</dd>
        <dt>Net fee</dt><dd><b>${esc(b.fee)} €</b></dd>
        <dt>Transport</dt><dd>${yn(b.transport, b.transport_details)}</dd>
        <dt>Accommodation</dt><dd>${yn(b.accommodation, b.accommodation_details)}</dd>
        <dt>Hospitality</dt><dd>${yn(b.hospitality, b.hospitality_details)}</dd>
      </dl></details>
    <hr class="sep">
    ${(msgs || []).map((m) => `
      <div class="comment ${m.author_kind === "artist" ? "note-me" : m.author_kind === "manager" ? "note-mgr" : ""}">
        <div class="meta"><span><b>${esc(m.author_name || "")}</b> · ${LBL[m.author_kind]}</span><span>${fmtDate(m.created_at)}</span></div>
        <div class="body">${esc(m.body)}</div></div>`).join("") || `<p class="muted">No messages with the promoter yet.</p>`}
    <form id="noteForm" style="margin-top:.8rem">
      <label class="field"><span>Message your manager — <b>the promoter will never see this</b></span>
        <textarea name="body" required placeholder="e.g. OK for the date, but I'd rather play after midnight…"></textarea></label>
      <button class="btn primary" type="submit">Send to my manager</button>
    </form>`;
  $("#noteForm").onsubmit = async (e) => {
    e.preventDefault();
    const body = e.target.body.value.trim(); if (!body) return;
    const { data: m, error } = await sb.from("floriqa_messages").insert({
      booking_id: id, author_kind: "artist", visibility: "internal", author: user.id,
      author_name: `${artist.person}${artist.kind === "team" ? ` (${artist.name} team)` : ""}`, author_role: artist.kind, body,
    }).select().single();
    if (error) return toast("Error: " + error.message, "err");
    mail({ type: "message", id: m.id });
    toast("Sent to your manager."); openBooking(id);
  };
}

// =============== MY ARTIST PAGE ===============
const FIELDS = [["tagline", "Tagline"], ["bio", "Biography"], ["instagram", "Instagram"], ["spotify", "Spotify"], ["soundcloud", "SoundCloud"], ["youtube", "YouTube"], ["website", "Website"], ["photo_url", "Main photo"], ["card_url", "Square photo (artists list)"], ["gallery", "Gallery"]];
const RSTATUS = { awaiting_artists: "Waiting for artist approval", pending_admin: "Waiting for Floriqa approval", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" };
const RCLASS = { awaiting_artists: "new", pending_admin: "in_progress", approved: "accepted", rejected: "declined", cancelled: "archived" };
let draft = null;

const show = (k, v) => {
  if (k === "gallery") return (v || []).length ? `<div class="gal">${v.map((u) => `<img src="${esc(media(u))}">`).join("")}</div>` : "—";
  if (k === "photo_url" || k === "card_url") return v ? `<img src="${esc(media(v))}" style="width:80px;height:80px;object-fit:cover;border-radius:8px">` : "—";
  return v ? `<span style="white-space:pre-wrap">${esc(v)}</span>` : "—";
};

async function loadPage() {
  const pane = $("#pagePane");
  const [{ data: a }, { data: reqs }, { data: snap }] = await Promise.all([
    sb.from("floriqa_artists").select("*, floriqa_artist_photos(url,sort)").eq("id", artist.id).single(),
    sb.from("floriqa_profile_requests").select("*").eq("artist_id", artist.id).order("created_at", { ascending: false }).limit(20),
    Promise.resolve({ data: null }),
  ]);
  const cur = {
    tagline: a.tagline, bio: a.bio, instagram: a.instagram, spotify: a.spotify, soundcloud: a.soundcloud, youtube: a.youtube, website: a.website,
    photo_url: a.photo_url, card_url: a.card_url, gallery: (a.floriqa_artist_photos || []).sort((x, y) => x.sort - y.sort).map((p) => p.url),
  };
  draft = JSON.parse(JSON.stringify(cur));
  const isMember = artist.kind === "member";
  const mode = a.edit_approval;
  const open = (reqs || []).filter((r) => ["awaiting_artists", "pending_admin"].includes(r.status));

  pane.innerHTML = `
    <div class="split">
      <section class="card">
        <div class="toolbar"><h3 class="grow">Request changes to your page</h3><a class="btn small" target="_blank" href="../artist.html?a=${esc(a.slug)}">View public page ↗</a></div>
        <p class="muted" style="margin-bottom:1rem">Your changes are sent to Floriqa for approval before they appear on floriqa.xyz.${!isMember && mode !== "none" ? ` As a team member, ${mode === "all" ? "all the artists" : "one of the artists"} must approve them first.` : ""}</p>
        <form id="pgForm">
          <label class="field"><span>Tagline</span><input type="text" name="tagline" value="${esc(cur.tagline || "")}"></label>
          <label class="field"><span>Biography</span><textarea name="bio" style="min-height:160px">${esc(cur.bio || "")}</textarea></label>
          <div class="row2">
            <label class="field"><span>Instagram</span><input type="url" name="instagram" value="${esc(cur.instagram || "")}"></label>
            <label class="field"><span>Spotify</span><input type="url" name="spotify" value="${esc(cur.spotify || "")}"></label>
          </div>
          <div class="row2">
            <label class="field"><span>SoundCloud</span><input type="url" name="soundcloud" value="${esc(cur.soundcloud || "")}"></label>
            <label class="field"><span>YouTube</span><input type="url" name="youtube" value="${esc(cur.youtube || "")}"></label>
          </div>
          <label class="field"><span>Website</span><input type="url" name="website" value="${esc(cur.website || "")}"></label>
          <div class="row2">
            <div class="field"><span>Main photo</span><div id="pv_photo_url"></div><input type="file" accept="image/*" data-up="photo_url"></div>
            <div class="field"><span>Square photo (artists list)</span><div id="pv_card_url"></div><input type="file" accept="image/*" data-up="card_url"></div>
          </div>
          <div class="field"><span>Gallery</span><div class="gal" id="galEdit"></div><input type="file" accept="image/*" multiple id="galAdd" style="margin-top:.4rem"></div>
          <button class="btn primary" type="submit">Send for approval</button>
        </form>
      </section>
      <aside>
        ${isMember ? `<div class="card">
          <h3 style="margin-bottom:.6rem">Team changes</h3>
          <p class="muted" style="margin-bottom:.6rem">When a team member requests a change, before it goes to Floriqa:</p>
          ${[["none", "No artist approval needed"], ["one", "One artist must approve"], ["all", "All artists must approve"]].map(([k, l]) =>
            `<label class="chk"><input type="radio" name="mode" value="${k}" ${mode === k ? "checked" : ""}> ${l}</label>`).join("")}
        </div>` : ""}
        <div class="card"><h3 style="margin-bottom:.6rem">Requests</h3><div id="reqList">${(reqs || []).map((r) => `
          <div class="list-item" data-id="${r.id}" style="display:block">
            <div class="toolbar" style="margin:0"><span class="grow muted">${fmtDate(r.created_at)} · ${esc(r.requested_email || "")}</span><span class="badge ${RCLASS[r.status]}">${RSTATUS[r.status]}</span></div>
          </div>`).join("") || `<p class="muted">No requests yet.</p>`}</div></div>
      </aside>
    </div>`;

  const renderMedia = () => {
    ["photo_url", "card_url"].forEach((k) => $("#pv_" + k).innerHTML = draft[k] ? `<img src="${esc(media(draft[k]))}" style="width:90px;height:90px;object-fit:cover;border-radius:8px;margin-bottom:.4rem">` : "");
    $("#galEdit").innerHTML = draft.gallery.map((u, i) => `<div class="g"><img src="${esc(media(u))}"><button type="button" class="btn small danger" data-rm="${i}" style="padding:.1rem .4rem">×</button></div>`).join("") || `<span class="muted">No photos.</span>`;
    $$("[data-rm]").forEach((b) => b.onclick = () => { draft.gallery.splice(+b.dataset.rm, 1); renderMedia(); });
  };
  renderMedia();
  const upload = async (file) => {
    if (file.size > MAX) { toast(`"${file.name}" is larger than 50 MB.`, "err"); return null; }
    const path = `requests/${artist.id}/${Date.now()}-${safeName(file.name)}`;
    const { error } = await sb.storage.from(PUB).upload(path, file, { contentType: file.type });
    if (error) { toast("Upload failed: " + error.message, "err"); return null; }
    return sb.storage.from(PUB).getPublicUrl(path).data.publicUrl;
  };
  $$("[data-up]").forEach((inp) => inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    toast("Uploading…"); const u = await upload(f); if (u) { draft[inp.dataset.up] = u; renderMedia(); }
  });
  $("#galAdd").onchange = async (e) => {
    toast("Uploading…");
    for (const f of e.target.files) { const u = await upload(f); if (u) draft.gallery.push(u); }
    renderMedia();
  };
  $("#pgForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    ["tagline", "bio", "instagram", "spotify", "soundcloud", "youtube", "website"].forEach((k) => draft[k] = (fd.get(k) || "").toString().trim() || null);
    const changed = {};
    FIELDS.forEach(([k]) => { if (JSON.stringify(draft[k] ?? null) !== JSON.stringify(cur[k] ?? null)) changed[k] = draft[k]; });
    if (!Object.keys(changed).length) return toast("You haven't changed anything.", "err");
    const { error } = await sb.rpc("floriqa_submit_profile_request", { p_artist: artist.id, p_proposed: changed });
    if (error) return toast("Error: " + error.message, "err");
    toast("Request sent."); loadPage();
  };
  $$("input[name=mode]").forEach((r) => r.onchange = async () => {
    const { error } = await sb.rpc("floriqa_set_edit_approval", { p_artist: artist.id, p_mode: r.value });
    toast(error ? "Error: " + error.message : "Saved.", error ? "err" : "ok");
  });
  $$("#reqList .list-item").forEach((el) => el.onclick = () => showRequest((reqs || []).find((r) => r.id === el.dataset.id)));
}

function showRequest(r) {
  const isMember = artist.kind === "member";
  const keys = Object.keys(r.proposed);
  const full = { ...r.previous, ...r.proposed };
  const box = document.createElement("div");
  box.className = "card";
  box.style.cssText = "position:fixed;inset:5vh 5vw;overflow:auto;z-index:200;background:#141821";
  box.innerHTML = `
    <div class="toolbar"><h3 class="grow">Change request · ${fmtDate(r.created_at)}</h3><span class="badge ${RCLASS[r.status]}">${RSTATUS[r.status]}</span><button class="btn small" id="x">Close</button></div>
    <p class="muted">Requested by ${esc(r.requested_email || "")} (${r.requester_kind === "team" ? "team" : "artist"})${r.approvals?.length ? ` · approved by ${r.approvals.map(esc).join(", ")}` : ""}${r.admin_note ? ` · Floriqa note: ${esc(r.admin_note)}` : ""}</p>
    <h4 style="margin:1rem 0 .4rem">What changes</h4>
    <table class="diff" style="width:100%"><tr><th>Field</th><th>Before</th><th>After</th></tr>
      ${keys.map((k) => `<tr><td>${FIELDS.find((f) => f[0] === k)?.[1] || k}</td><td>${show(k, r.previous[k])}</td><td>${show(k, r.proposed[k])}</td></tr>`).join("")}</table>
    <h4 style="margin:1.2rem 0 .4rem">Full page after the change</h4>
    <table class="diff" style="width:100%">${FIELDS.map(([k, l]) => `<tr><td>${l}</td><td>${show(k, full[k])}</td></tr>`).join("")}</table>
    <div class="toolbar" style="margin-top:1rem">
      ${r.status === "awaiting_artists" && isMember ? `<button class="btn primary" id="ok">Approve</button>` : ""}
      ${["awaiting_artists", "pending_admin"].includes(r.status) && (isMember || r.requested_by === user.id) ? `<button class="btn danger" id="cancel">Cancel request</button>` : ""}
    </div>`;
  document.body.appendChild(box);
  $("#x", box).onclick = () => box.remove();
  const ok = $("#ok", box);
  if (ok) ok.onclick = async () => {
    const { data, error } = await sb.rpc("floriqa_artist_approve_request", { p_id: r.id });
    if (error) return toast("Error: " + error.message, "err");
    toast(data === "pending_admin" ? "Approved — sent to Floriqa." : "Approved — waiting for the other artists."); box.remove(); loadPage();
  };
  const c = $("#cancel", box);
  if (c) c.onclick = async () => {
    if (!confirm("Cancel this request?")) return;
    const { error } = await sb.rpc("floriqa_cancel_request", { p_id: r.id });
    if (error) return toast("Error: " + error.message, "err");
    box.remove(); loadPage();
  };
}

// =============== MY ROOMS ===============
let rooms = [], roomSel = null;
async function loadRooms() {
  const { data } = await sb.from("floriqa_rooms").select("*, floriqa_room_files(count), floriqa_room_posts(count)").order("updated_at", { ascending: false });
  rooms = data || [];
  $("#roomList").innerHTML = rooms.length ? rooms.map((r) => `
    <div class="list-item ${r.id === roomSel ? "sel" : ""}" data-id="${r.id}"><div><b>${esc(r.title)}</b>
      <div class="muted">${r.floriqa_room_posts?.[0]?.count || 0} posts · ${r.floriqa_room_files?.[0]?.count || 0} files${r.created_by === user.id ? " · yours" : ""}</div></div></div>`).join("")
    : `<p class="muted">You're not in any room yet.</p>`;
  $$("#roomList .list-item").forEach((el) => el.onclick = () => openRoom(el.dataset.id));
}
const myName = () => artist?.kind === "member" ? `${artist.person} (${artist.name})` : (me.admin_name || "Floriqa") + " (Floriqa)";

async function artistPicker(selected = []) {
  const { data } = await sb.rpc("floriqa_room_directory");
  return `<div style="max-height:260px;overflow:auto;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:.4rem .7rem">${(data || []).map((a) =>
    `<label class="chk"><input type="checkbox" name="artists" value="${a.id}" ${selected.includes(a.id) ? "checked" : ""}> ${esc(a.name)}</label>`).join("") || `<span class="muted">No artists yet.</span>`}</div>`;
}

$("#newRoom").onclick = async () => {
  roomSel = null; loadRooms();
  $("#roomView").innerHTML = `
    <h3 style="margin-bottom:1rem">New room</h3>
    <form id="nrForm">
      <label class="field"><span>Name</span><input type="text" name="title" required maxlength="120" placeholder="e.g. Summer EP, Kolok x Saray remix…"></label>
      <label class="field"><span>Description</span><textarea name="description" maxlength="2000"></textarea></label>
      <div class="field"><span>Invite artists (their artist members get access — never their team)</span>${await artistPicker(artist?.kind === "member" ? [artist.id] : [])}</div>
      <button class="btn primary" type="submit">Create room</button>
    </form>`;
  $("#nrForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { data: r, error } = await sb.from("floriqa_rooms").insert({ title: f.get("title").trim(), description: f.get("description").trim() || null, created_by: user.id }).select().single();
    if (error) return toast("Error: " + error.message, "err");
    const ids = f.getAll("artists");
    if (ids.length) await sb.from("floriqa_room_artists").insert(ids.map((a) => ({ room_id: r.id, artist_id: a })));
    await loadRooms(); openRoom(r.id);
  };
};

async function openRoom(id) {
  roomSel = id; loadRooms();
  const r = rooms.find((x) => x.id === id) || (await sb.from("floriqa_rooms").select("*").eq("id", id).single()).data;
  const owner = r.created_by === user.id;
  const [{ data: people }, { data: files }, { data: posts }] = await Promise.all([
    sb.rpc("floriqa_room_people", { p_room: id }),
    sb.from("floriqa_room_files").select("*").eq("room_id", id).order("created_at", { ascending: false }),
    sb.from("floriqa_room_posts").select("*").eq("room_id", id).order("created_at"),
  ]);
  const byArtist = {};
  (people || []).forEach((p) => (byArtist[p.artist_id] ||= { name: p.artist_name, people: [] }).people.push(p));

  $("#roomView").innerHTML = `
    <div class="toolbar"><h3 class="grow">${esc(r.title)}</h3>
      ${owner ? `<button class="btn small" id="manage">Manage artists</button><button class="btn small danger" id="delRoom">Delete room</button>` : `<button class="btn small danger" id="leave">Leave room</button>`}</div>
    ${r.description ? `<p style="white-space:pre-wrap;margin-bottom:.6rem">${esc(r.description)}</p>` : ""}
    <p class="muted">Artists: ${Object.values(byArtist).map((a) => esc(a.name)).join(", ") || "—"}</p>
    <div id="manageBox"></div>
    <hr class="sep">
    <h3 style="margin-bottom:.6rem">Files</h3>
    <div class="drop" id="drop"><b>Drop files here</b> or click to choose<br><span class="muted">Audio, zipped DAW projects (Ableton, Logic, FL…), PDFs · 50 MB max per file</span>
      <input type="file" id="fileInput" multiple hidden><div class="progress hidden" id="prog"><i></i></div></div>
    <div id="files" style="margin-top:.8rem">${(files || []).map((f) => `
      <div class="file-row" data-id="${f.id}">
        <div><b>${esc(f.name)}</b> <span class="muted">· ${KIND[f.kind]} · ${fmtSize(f.size_bytes)} · ${esc(f.author_name || "")} · ${fmtDate(f.created_at)}</span></div>
        <div class="actions"><button class="btn small" data-dl>Download</button>${f.uploaded_by === user.id || owner ? `<button class="btn small danger" data-del>×</button>` : ""}</div>
        ${f.kind === "audio" ? `<audio controls preload="none" data-path="${esc(f.storage_path)}"></audio>` : ""}
      </div>`).join("") || `<p class="muted">No files yet.</p>`}</div>
    <hr class="sep">
    <h3 style="margin-bottom:.6rem">Topics & messages</h3>
    <div id="posts">${(posts || []).map((p) => `
      <div class="comment">
        <div class="meta"><span><b>${esc(p.author_name || "")}</b></span><span>${fmtDate(p.created_at)} ${p.author === user.id || owner ? `<a href="#" data-pdel="${p.id}" class="muted">delete</a>` : ""}</span></div>
        ${p.title ? `<div style="font-weight:700;margin-bottom:.2rem">${esc(p.title)}</div>` : ""}<div class="body">${esc(p.body)}</div></div>`).join("") || `<p class="muted">No messages yet.</p>`}</div>
    <form id="postForm" style="margin-top:.8rem">
      <input type="text" name="title" placeholder="New topic title (optional)" maxlength="160" style="margin-bottom:.5rem">
      <textarea name="body" required maxlength="4000" placeholder="Write a message…"></textarea>
      <div class="toolbar" style="margin-top:.5rem"><button class="btn primary" type="submit">Post</button></div>
    </form>`;

  if (owner) {
    $("#delRoom").onclick = async () => {
      if (!confirm(`Delete "${r.title}" with all its files and messages? This cannot be undone.`)) return;
      const paths = (files || []).map((f) => f.storage_path);
      if (paths.length) await sb.storage.from(ROOM_BUCKET).remove(paths);
      const { error } = await sb.from("floriqa_rooms").delete().eq("id", id);
      if (error) return toast("Error: " + error.message, "err");
      roomSel = null; $("#roomView").innerHTML = `<p class="muted">Room deleted.</p>`; loadRooms();
    };
    $("#manage").onclick = async () => {
      const current = Object.keys(byArtist);
      $("#manageBox").innerHTML = `<div class="card" style="margin-top:.8rem">
        <div class="field"><span>Artists in this room</span>${await artistPicker(current)}</div>
        <button class="btn small primary" id="saveArtists">Save artists</button>
        ${Object.values(byArtist).some((a) => a.people.length > 1) ? `<h4 style="margin:1rem 0 .4rem">Remove one person (group members)</h4>${(people || []).map((p) => `
          <div class="chk"><span class="grow">${esc(p.artist_name)} — ${esc(p.person)}</span>
          ${p.excluded ? `<button class="btn small" data-back="${esc(p.email)}">Re-add</button>` : `<button class="btn small danger" data-out="${esc(p.email)}">Remove</button>`}</div>`).join("")}` : ""}
      </div>`;
      $("#saveArtists").onclick = async () => {
        const want = $$("#manageBox input[name=artists]:checked").map((x) => x.value);
        const add = want.filter((x) => !current.includes(x)), rem = current.filter((x) => !want.includes(x));
        if (add.length) await sb.from("floriqa_room_artists").insert(add.map((a) => ({ room_id: id, artist_id: a })));
        for (const a of rem) await sb.from("floriqa_room_artists").delete().eq("room_id", id).eq("artist_id", a);
        toast("Room updated."); openRoom(id);
      };
      $$("[data-out]").forEach((b) => b.onclick = async () => {
        await sb.from("floriqa_room_exclusions").insert({ room_id: id, email: b.dataset.out, reason: "removed" }); openRoom(id);
      });
      $$("[data-back]").forEach((b) => b.onclick = async () => {
        await sb.from("floriqa_room_exclusions").delete().eq("room_id", id).eq("email", b.dataset.back); openRoom(id);
      });
    };
  } else {
    $("#leave").onclick = async () => {
      if (!confirm(`Leave "${r.title}"? You'll need to be added again to come back.`)) return;
      const { error } = await sb.from("floriqa_room_exclusions").insert({ room_id: id, email: me.email, reason: "left" });
      if (error) return toast("Error: " + error.message, "err");
      roomSel = null; $("#roomView").innerHTML = `<p class="muted">You left the room.</p>`; loadRooms();
    };
  }

  $$("#files audio").forEach((a) => a.addEventListener("play", async () => {
    if (a.dataset.ready) return;
    const { data } = await sb.storage.from(ROOM_BUCKET).createSignedUrl(a.dataset.path, 3600);
    if (data) { a.src = data.signedUrl; a.dataset.ready = 1; a.play(); }
  }));
  $$("#files .file-row").forEach((row) => {
    const f = files.find((x) => x.id === row.dataset.id);
    $("[data-dl]", row).onclick = async () => {
      const { data } = await sb.storage.from(ROOM_BUCKET).createSignedUrl(f.storage_path, 600, { download: f.name });
      if (data) location.href = data.signedUrl;
    };
    const d = $("[data-del]", row);
    if (d) d.onclick = async () => {
      if (!confirm(`Delete "${f.name}"?`)) return;
      await sb.storage.from(ROOM_BUCKET).remove([f.storage_path]);
      await sb.from("floriqa_room_files").delete().eq("id", f.id); openRoom(id);
    };
  });
  $$("[data-pdel]").forEach((a) => a.onclick = async (e) => { e.preventDefault(); await sb.from("floriqa_room_posts").delete().eq("id", a.dataset.pdel); openRoom(id); });
  $("#postForm").onsubmit = async (e) => {
    e.preventDefault();
    const body = e.target.body.value.trim(); if (!body) return;
    const { error } = await sb.from("floriqa_room_posts").insert({ room_id: id, author: user.id, author_name: myName(), title: e.target.title.value.trim() || null, body });
    if (error) return toast("Error: " + error.message, "err");
    openRoom(id);
  };

  const drop = $("#drop"), input = $("#fileInput");
  drop.onclick = () => input.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); upload([...e.dataTransfer.files]); };
  input.onchange = () => upload([...input.files]);
  async function upload(list) {
    const ok = list.filter((f) => f.size <= MAX || (toast(`"${f.name}" is larger than 50 MB.`, "err"), false));
    if (!ok.length) return;
    $("#prog").classList.remove("hidden");
    let done = 0;
    for (const f of ok) {
      $("#prog i").style.width = Math.round((done / ok.length) * 100) + 5 + "%";
      const path = `${id}/${crypto.randomUUID()}-${safeName(f.name)}`;
      const { error } = await sb.storage.from(ROOM_BUCKET).upload(path, f, { contentType: f.type || "application/octet-stream" });
      if (error) { toast(`Upload failed for "${f.name}": ${error.message}`, "err"); continue; }
      await sb.from("floriqa_room_files").insert({ room_id: id, name: f.name, kind: kindOf(f.name), storage_path: path, size_bytes: f.size, uploaded_by: user.id, author_name: myName() });
      done++;
    }
    toast(`${done} file(s) uploaded.`); openRoom(id);
  }
}

boot();
