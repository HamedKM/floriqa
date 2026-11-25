// Floriqa — panneau admin
const { sb, esc, media, buildChrome, toast, fmtDate, fmtSize, mail } = Floriqa;
buildChrome({ video: false });

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const show = (id) => ["login", "denied", "panel"].forEach((x) => $("#" + x).classList.toggle("hidden", x !== id));
const MAX = 50 * 1024 * 1024;
const PUB = "floriqa-public";
const PK = "floriqa-presskit";
const SITE = location.origin + location.pathname.replace(/admin\/.*$/, "");
const STATUS = { new: "Nouvelle", in_progress: "En cours", accepted: "Acceptée", declined: "Refusée", archived: "Archivée" };
const ROLES = { admin: "Admin", team: "Équipe", artist: "Artiste" };
const PKCAT = { photo: "Photos HD", presentation: "Présentations / riders", video: "Vidéos", audio: "Audio", admin: "Papiers administratifs", other: "Autres" };
let me = null, user = null;

// ---------- connexion ----------
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const { error } = await sb.auth.signInWithPassword({ email: f.get("email"), password: f.get("password") });
  if (error) return toast("E-mail ou mot de passe incorrect.", "err");
  boot();
});
$$("[data-logout]").forEach((b) => b.addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); }));

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session || session.user.is_anonymous) return show("login");
  user = session.user;
  await sb.rpc("floriqa_claim_invite");
  const { data: m } = await sb.from("floriqa_members").select("*").eq("user_id", user.id).maybeSingle();
  if (!m || m.role !== "admin") return show("denied");
  me = m;
  $("#who").textContent = m.display_name;
  $("#roomLink").textContent = SITE + "room/";
  show("panel");
  await loadArtists();
  await loadBookings();
  loadMembers();
  const wanted = new URLSearchParams(location.search).get("b");
  if (wanted) showBooking(wanted);
}

// ---------- onglets ----------
$$(".tab").forEach((t) => t.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
  $$("[data-pane]").forEach((p) => p.classList.toggle("hidden", p.dataset.pane !== t.dataset.tab));
}));

// =============== BOOKINGS ===============
let bookings = [];
let bkSel = null;
async function loadBookings() {
  const { data, error } = await sb.from("floriqa_bookings").select("*, floriqa_messages(count)").order("created_at", { ascending: false });
  if (error) return toast("Impossible de charger les bookings.", "err");
  bookings = data;
  const c = (s) => data.filter((b) => b.status === s).length;
  $("#nNew").textContent = c("new") || "";
  $("#bkStats").innerHTML = [["new", "Nouvelles"], ["in_progress", "En cours"], ["accepted", "Acceptées"], ["declined", "Refusées"]]
    .map(([k, l]) => `<div class="stat"><b>${c(k)}</b><span class="muted">${l}</span></div>`).join("");
  renderBookings();
}
function renderBookings() {
  const f = $("#bkFilter").value;
  const q = $("#bkSearch").value.trim().toLowerCase();
  const list = bookings.filter((b) =>
    (f === "all" || (f === "open" ? ["new", "in_progress"].includes(b.status) : b.status === f)) &&
    (!q || [b.artist_name, b.event, b.organization, b.promoter, b.city, b.country].join(" ").toLowerCase().includes(q)));
  $("#bkList").innerHTML = list.length ? list.map((b) => `
    <div class="list-item ${b.id === bkSel ? "sel" : ""}" data-id="${b.id}">
      <div><b>${esc(b.artist_name)}</b> · ${esc(b.event)}<div class="muted">${esc(b.city)} · ${esc(b.dates)} · ${b.floriqa_messages?.[0]?.count || 0} message(s)</div></div>
      <span class="badge ${b.status}">${STATUS[b.status]}</span>
    </div>`).join("") : `<p class="muted">Aucune demande.</p>`;
  $$("#bkList .list-item").forEach((el) => el.addEventListener("click", () => showBooking(el.dataset.id)));
}
$("#bkFilter").addEventListener("change", renderBookings);
$("#bkSearch").addEventListener("input", renderBookings);
$("#bkRefresh").addEventListener("click", async () => { await loadBookings(); if (bkSel) showBooking(bkSel); });

const KIND = {
  promoter: { label: "Promoteur", cls: "", note: "" },
  manager: { label: "Manager", cls: "", note: "envoyé au promoteur" },
  artist: { label: "Note interne de l'artiste", cls: "internal", note: "le promoteur ne la voit pas" },
};
const mailState = (m) => m.author_kind === "promoter" ? "reçu par e-mail" :
  m.email_status === "sent" ? "e-mail envoyé ✓" : m.email_status === "failed" ? `e-mail en échec` : m.email_status === "pending" ? "e-mail en attente" : "";

async function showBooking(id) {
  bkSel = id;
  renderBookings();
  const b = bookings.find((x) => x.id === id);
  if (!b) return;
  const artist = artists.find((a) => a.id === b.artist_id);
  const yn = (v, d) => (v ? `Oui${d ? " — " + esc(d) : ""}` : "Non");
  const rows = [
    ["Reçue le", fmtDate(b.created_at)], ["Artiste", esc(b.artist_name)],
    ["Manager", artist?.manager_email ? esc(artist.manager_email) : `<span style="color:#ffb3ba">aucun — à régler dans la fiche artiste</span>`],
    ["Organisation", esc(b.organization)], ["Organisateur", esc(b.promoter)],
    ["Téléphone", `<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`], ["E-mail", esc(b.email)],
    ["Événement", esc(b.event)], ["Lieu", esc(b.venue)], ["Date(s)", esc(b.dates)], ["Line-up", esc(b.lineup)],
    ["Ville / Pays", `${esc(b.city)}, ${esc(b.country)}`],
    ["Réseau social", b.social_link ? `<a target="_blank" rel="noopener" href="${esc(/^https?:/.test(b.social_link) ? b.social_link : "https://" + b.social_link)}">${esc(b.social_link)}</a>` : "—"],
    ["B2B", esc(b.b2b || "Non")], ["Durée", esc(b.duration)], ["Horaire", esc(b.perf_time)], ["Cachet net", `<b>${esc(b.fee)} €</b>`],
    ["Transport", yn(b.transport, b.transport_details)], ["Hébergement", yn(b.accommodation, b.accommodation_details)], ["Hospitalité", yn(b.hospitality, b.hospitality_details)],
  ];
  const { data: msgs } = await sb.from("floriqa_messages").select("*").eq("booking_id", id).order("created_at");
  const pk = artist?.floriqa_presskits;
  const pkLink = pk?.enabled ? `${SITE}presskit.html?k=${pk.token}` : null;

  $("#bkDetail").innerHTML = `
    <div class="toolbar"><h3 class="grow">${esc(b.artist_name)} · ${esc(b.event)}</h3><span class="badge ${b.status}">${STATUS[b.status]}</span></div>
    <details><summary class="muted" style="cursor:pointer;margin-bottom:.6rem">Détails de la demande</summary><dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></details>
    <hr class="sep">
    <h3 style="margin-bottom:.6rem">Conversation</h3>
    <div class="comment"><div class="meta"><span><b>${esc(b.promoter)}</b> · Promoteur · demande de booking</span><span>${fmtDate(b.created_at)}</span></div>
      <div class="body muted">Formulaire envoyé (voir les détails ci-dessus).</div></div>
    ${(msgs || []).map((m) => `
      <div class="comment ${KIND[m.author_kind].cls}" style="${m.author_kind === "artist" ? "border-left:3px solid #f9e6b3;background:rgba(249,230,179,.08)" : m.author_kind === "manager" ? "border-left:3px solid #d3ecf7" : ""}">
        <div class="meta"><span><b>${esc(m.author_name || "")}</b> · ${KIND[m.author_kind].label}${KIND[m.author_kind].note ? ` <i>(${KIND[m.author_kind].note})</i>` : ""}</span>
          <span>${fmtDate(m.created_at)} · ${mailState(m)}</span></div>
        <div class="body">${esc(m.body)}</div>
        ${m.email_status === "failed" ? `<div class="muted" style="color:#ffb3ba">${esc(m.email_error || "")}</div>` : ""}
      </div>`).join("")}
    <form id="replyForm" style="margin-top:.8rem">
      <label class="field"><span>Répondre au promoteur (${esc(b.email)})</span><textarea name="body" required placeholder="Votre réponse…"></textarea></label>
      <div class="toolbar">
        <button class="btn primary" type="submit">Envoyer au promoteur</button>
        ${pkLink ? `<button class="btn" type="button" id="insertPk">Insérer le lien presskit</button>` : `<span class="muted">Pas de lien presskit actif pour cet artiste</span>`}
      </div>
    </form>
    <hr class="sep">
    <div class="row2">
      <label class="field"><span>Statut</span>
        <select id="bkStatus">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === b.status ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="field"><span>Artiste lié</span>
        <select id="bkArtist"><option value="">—</option>${artists.map((a) => `<option value="${a.id}" ${a.id === b.artist_id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
    </div>
    <label class="field"><span>Notes admin (personne d'autre ne les voit)</span><textarea id="bkNotes">${esc(b.admin_notes || "")}</textarea></label>
    <div class="toolbar"><button class="btn" id="bkSave">Enregistrer</button><span class="grow"></span><button class="btn danger" id="bkDel">Supprimer</button></div>`;

  if (pkLink) $("#insertPk").onclick = () => {
    const ta = $("#replyForm textarea");
    ta.value = (ta.value ? ta.value + "\n\n" : "") + `Press kit ${b.artist_name}: ${pkLink}`;
    ta.focus();
  };
  $("#replyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = e.target.body.value.trim(); if (!body) return;
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Envoi…";
    const { data: m, error } = await sb.from("floriqa_messages").insert({
      booking_id: id, author_kind: "manager", visibility: "external", author: user.id, author_name: me.display_name, body,
    }).select().single();
    if (error) { btn.disabled = false; btn.textContent = "Envoyer au promoteur"; return toast("Erreur : " + error.message, "err"); }
    const r = await mail({ type: "message", id: m.id });
    if (b.status === "new") await sb.from("floriqa_bookings").update({ status: "in_progress" }).eq("id", id);
    toast(r?.ok ? "Réponse envoyée au promoteur." : "Réponse enregistrée — l'e-mail n'est pas parti (envoi pas encore activé).", r?.ok ? "ok" : "err");
    await loadBookings(); showBooking(id);
  });
  $("#bkSave").onclick = async () => {
    const { error } = await sb.from("floriqa_bookings").update({ status: $("#bkStatus").value, admin_notes: $("#bkNotes").value || null, artist_id: $("#bkArtist").value || null }).eq("id", id);
    if (error) return toast("Erreur d'enregistrement.", "err");
    toast("Demande mise à jour."); await loadBookings(); showBooking(id);
  };
  $("#bkDel").onclick = async () => {
    if (!confirm("Supprimer définitivement cette demande et toute sa conversation ?")) return;
    const { error } = await sb.from("floriqa_bookings").delete().eq("id", id);
    if (error) return toast("Erreur de suppression.", "err");
    bkSel = null; $("#bkDetail").innerHTML = `<p class="muted">Demande supprimée.</p>`; loadBookings();
  };
}

// =============== ARTISTES ===============
let artists = [];
let arSel = null;
async function loadArtists() {
  const { data, error } = await sb.from("floriqa_artists")
    .select("*, floriqa_tracks(*), floriqa_videos(*), floriqa_artist_photos(*), floriqa_presskits(*), floriqa_presskit_files(*)").order("sort").order("name");
  if (error) return toast("Impossible de charger les artistes.", "err");
  artists = data.map((a) => ({ ...a, floriqa_presskits: Array.isArray(a.floriqa_presskits) ? a.floriqa_presskits[0] : a.floriqa_presskits }));
  $("#arList").innerHTML = artists.map((a) => `
    <div class="list-item ${a.id === arSel ? "sel" : ""}" data-id="${a.id}">
      <div style="display:flex;gap:.7rem;align-items:center">
        ${(a.card_url || a.photo_url) ? `<img class="thumb" src="${esc(media(a.card_url || a.photo_url))}" alt="">` : `<div class="thumb"></div>`}
        <div><b>${esc(a.name)}</b><div class="muted">${esc(a.tagline || "")}</div></div>
      </div>
      ${a.published ? "" : `<span class="badge">Masqué</span>`}
    </div>`).join("");
  $$("#arList .list-item").forEach((el) => el.addEventListener("click", () => showArtist(el.dataset.id)));
  const opts = `<option value="">— aucune fiche —</option>` + artists.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
  if ($("#invArtist")) $("#invArtist").innerHTML = opts;
  if (arSel) showArtist(arSel);
}
const slugify = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const safeName = (n) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
const tooBig = (file) => { if (file.size > MAX) { toast(`« ${file.name} » dépasse 50 Mo (limite de l'offre gratuite).`, "err"); return true; } return false; };

async function uploadPublic(file, slug) {
  if (tooBig(file)) return null;
  const path = `artists/${slug}/${Date.now()}-${safeName(file.name)}`;
  const { error } = await sb.storage.from(PUB).upload(path, file, { contentType: file.type || undefined });
  if (error) { toast("Échec de l'envoi : " + error.message, "err"); return null; }
  return sb.storage.from(PUB).getPublicUrl(path).data.publicUrl;
}
async function removePublic(url) {
  const marker = `/storage/v1/object/public/${PUB}/`;
  if (url && url.includes(marker)) await sb.storage.from(PUB).remove([decodeURIComponent(url.split(marker)[1])]);
}

$("#arNew").addEventListener("click", () => { arSel = null; $$("#arList .list-item").forEach((x) => x.classList.remove("sel")); artistForm(null); });

function artistForm(a) {
  const isNew = !a;
  a = a || { name: "", slug: "", tagline: "", bio: "", instagram: "", published: true, sort: (artists.at(-1)?.sort || 0) + 1 };
  const by = (x, y) => x.sort - y.sort;
  const tracks = (a.floriqa_tracks || []).sort(by);
  const vids = (a.floriqa_videos || []).sort(by);
  const photos = (a.floriqa_artist_photos || []).sort(by);
  const pk = a.floriqa_presskits;
  const pkFiles = (a.floriqa_presskit_files || []).sort((x, y) => x.category.localeCompare(y.category) || x.sort - y.sort);
  const pkLink = pk ? `${SITE}presskit.html?k=${pk.token}` : "";
  const f = (k, label, type = "text", ph = "") => `<label class="field"><span>${label}</span><input type="${type}" name="${k}" value="${esc(a[k] || "")}" placeholder="${ph}"></label>`;

  $("#arDetail").innerHTML = `
    <div class="toolbar"><h3 class="grow">${isNew ? "Nouvel artiste" : esc(a.name)}</h3>
      ${isNew ? "" : `<a class="btn small" target="_blank" href="../artist.html?a=${esc(a.slug)}">Voir la page publique ↗</a>`}</div>
    <form id="arForm">
      <div class="row2">
        <label class="field"><span>Nom</span><input type="text" name="name" required value="${esc(a.name)}"></label>
        <label class="field"><span>Adresse de la page (ex. kolok)</span><input type="text" name="slug" required pattern="[a-z0-9-]+" value="${esc(a.slug)}"></label>
      </div>
      <div class="row2">
        ${f("tagline", "Sous-titre (ex. DJ & Producer)")}
        ${f("manager_email", "E-mail du manager (reçoit les bookings)", "email", "manager@…")}
      </div>
      <label class="field"><span>Biographie</span><textarea name="bio" style="min-height:140px">${esc(a.bio || "")}</textarea></label>
      <div class="row2">${f("instagram", "Instagram", "url", "https://instagram.com/…")}${f("spotify", "Spotify", "url", "https://open.spotify.com/…")}</div>
      <div class="row2">${f("soundcloud", "SoundCloud", "url", "https://soundcloud.com/…")}${f("youtube", "YouTube", "url", "https://youtube.com/…")}</div>
      <div class="row2">
        ${f("website", "Site web", "url")}
        <div class="row2">
          <label class="field"><span>Ordre</span><input type="number" name="sort" value="${a.sort}"></label>
          <label class="field"><span>Visible sur le site</span><select name="published"><option value="1" ${a.published ? "selected" : ""}>Oui</option><option value="0" ${a.published ? "" : "selected"}>Non (masqué)</option></select></label>
        </div>
      </div>
      <div class="toolbar"><button class="btn primary" type="submit">${isNew ? "Créer l'artiste" : "Enregistrer"}</button>
        <span class="grow"></span>${isNew ? "" : `<button class="btn danger" type="button" id="arDel">Supprimer l'artiste</button>`}</div>
    </form>
    ${isNew ? "" : `
    <hr class="sep">
    <h3>Photos</h3>
    <div class="row2" style="margin-top:.6rem">
      <div class="field"><span>Photo carrée (liste des artistes)</span>
        ${a.card_url ? `<img class="thumb" style="width:90px;height:90px;margin-bottom:.4rem" src="${esc(media(a.card_url))}">` : ""}
        <input type="file" accept="image/*" data-up="card_url"></div>
      <div class="field"><span>Photo principale de la page</span>
        ${a.photo_url ? `<img class="thumb" style="width:90px;height:90px;margin-bottom:.4rem" src="${esc(media(a.photo_url))}">` : ""}
        <input type="file" accept="image/*" data-up="photo_url"></div>
    </div>
    <div class="field"><span>Galerie (page publique)</span>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.5rem">${photos.map((p) => `
        <div style="position:relative"><img class="thumb" style="width:90px;height:90px" src="${esc(media(p.url))}">
          <button class="btn small danger" data-phdel="${p.id}" style="position:absolute;top:2px;right:2px;padding:.1rem .4rem">×</button></div>`).join("") || `<span class="muted">Aucune photo.</span>`}</div>
      <input type="file" accept="image/*" multiple id="galFile"></div>

    <hr class="sep">
    <h3>Morceaux</h3>
    <div id="trList" style="margin:.8rem 0">${tracks.map((t) => `
      <div class="file-row" data-id="${t.id}">
        <input type="text" value="${esc(t.title)}" data-title>
        <div class="actions"><button class="btn small" data-save>Renommer</button><button class="btn small danger" data-del>Retirer</button></div>
        <audio controls preload="none" src="${esc(media(t.audio_url))}"></audio>
      </div>`).join("") || `<p class="muted">Aucun morceau.</p>`}</div>
    <div class="toolbar"><input type="text" id="trTitle" placeholder="Titre du morceau" class="grow" style="max-width:300px"><input type="file" id="trFile" accept="audio/*"><button class="btn" id="trAdd">Ajouter le morceau</button></div>

    <hr class="sep">
    <h3>Vidéos</h3>
    <div id="viList" style="margin:.8rem 0">${vids.map((v) => `
      <div class="file-row" data-id="${v.id}"><div>${esc(v.title || "Vidéo")} <span class="muted">· ${v.vertical ? "verticale" : "horizontale"}</span></div>
      <div class="actions"><a class="btn small" target="_blank" href="${esc(media(v.video_url))}">Voir</a><button class="btn small danger" data-del>Retirer</button></div></div>`).join("") || `<p class="muted">Aucune vidéo.</p>`}</div>
    <div class="toolbar"><input type="text" id="viTitle" placeholder="Titre" style="max-width:200px">
      <select id="viVert" style="max-width:160px"><option value="0">Horizontale</option><option value="1">Verticale</option></select>
      <input type="file" id="viFile" accept="video/mp4,video/*"><button class="btn" id="viAdd">Ajouter la vidéo</button></div>
    <p class="muted">Limite : 50 Mo par fichier.</p>

    <hr class="sep">
    <h3>🔒 Lien privé (presskit pour les promoteurs)</h3>
    <p class="muted" style="margin:.3rem 0 .8rem">Page secrète : seules les personnes qui ont le lien y accèdent. Elle reprend la bio, les photos, la musique et les vidéos, plus les fichiers privés ci-dessous.</p>
    ${pk ? `
      <div class="toolbar">
        <input type="text" readonly value="${esc(pkLink)}" id="pkLink" class="grow" style="max-width:520px">
        <button class="btn small" id="pkCopy">Copier</button>
        <a class="btn small" target="_blank" href="${esc(pkLink)}">Ouvrir ↗</a>
      </div>
      <div class="toolbar">
        <span class="badge ${pk.enabled ? "accepted" : "declined"}">${pk.enabled ? "Actif" : "Désactivé"}</span>
        <button class="btn small" id="pkToggle">${pk.enabled ? "Désactiver le lien" : "Réactiver le lien"}</button>
        <button class="btn small danger" id="pkRegen">Changer le lien (l'ancien ne marchera plus)</button>
      </div>
      <label class="field"><span>Message en haut de la page privée (facultatif)</span><textarea id="pkMsg" style="min-height:60px">${esc(pk.message || "")}</textarea></label>
      <button class="btn small" id="pkMsgSave">Enregistrer le message</button>
      <h4 style="margin:1.2rem 0 .6rem">Fichiers privés</h4>
      <div id="pkList">${pkFiles.map((x) => `
        <div class="file-row" data-id="${x.id}"><div><b>${esc(x.name)}</b> <span class="muted">· ${PKCAT[x.category]} · ${fmtSize(x.size_bytes)}</span></div>
          <div class="actions"><button class="btn small" data-dl>Télécharger</button><button class="btn small danger" data-del>×</button></div></div>`).join("") || `<p class="muted">Aucun fichier privé.</p>`}</div>
      <div class="toolbar" style="margin-top:.6rem">
        <select id="pkCat" style="width:auto">${Object.entries(PKCAT).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
        <input type="file" id="pkFile" multiple><button class="btn" id="pkAdd">Ajouter</button>
      </div>
      <div class="progress hidden" id="pkProg"><i></i></div>`
    : `<button class="btn primary" id="pkCreate">Créer le lien privé</button>`}
    `}
  `;

  const form = $("#arForm");
  form.name.addEventListener("input", () => { if (isNew) form.slug.value = slugify(form.name.value); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const g = (k) => (fd.get(k) || "").toString().trim() || null;
    const row = { name: g("name"), slug: slugify(g("slug") || ""), tagline: g("tagline"), bio: g("bio"), manager_email: g("manager_email")?.toLowerCase() || null,
      instagram: g("instagram"), spotify: g("spotify"), soundcloud: g("soundcloud"), youtube: g("youtube"), website: g("website"),
      sort: +fd.get("sort") || 0, published: fd.get("published") === "1" };
    const q = isNew ? sb.from("floriqa_artists").insert(row).select().single() : sb.from("floriqa_artists").update(row).eq("id", a.id).select().single();
    const { data, error } = await q;
    if (error) return toast(error.code === "23505" ? "Cette adresse de page existe déjà." : "Erreur : " + error.message, "err");
    toast(isNew ? "Artiste créé. Ajoute maintenant ses photos, morceaux et son lien privé." : "Artiste enregistré.");
    arSel = data.id; loadArtists();
  });
  if (isNew) return;

  $$("[data-up]").forEach((inp) => inp.addEventListener("change", async () => {
    const file = inp.files[0]; if (!file) return;
    toast("Envoi de la photo…");
    const url = await uploadPublic(file, a.slug); if (!url) return;
    const old = a[inp.dataset.up];
    const { error } = await sb.from("floriqa_artists").update({ [inp.dataset.up]: url }).eq("id", a.id);
    if (error) return toast("Erreur : " + error.message, "err");
    await removePublic(old); toast("Photo mise à jour."); loadArtists();
  }));
  $("#galFile").addEventListener("change", async (e) => {
    const files = [...e.target.files]; if (!files.length) return;
    toast(`Envoi de ${files.length} photo(s)…`);
    let n = (photos.at(-1)?.sort || 0);
    for (const file of files) {
      const url = await uploadPublic(file, a.slug); if (!url) continue;
      await sb.from("floriqa_artist_photos").insert({ artist_id: a.id, url, sort: ++n });
    }
    toast("Galerie mise à jour."); loadArtists();
  });
  $$("[data-phdel]").forEach((b) => b.onclick = async () => {
    const p = photos.find((x) => x.id === b.dataset.phdel);
    await sb.from("floriqa_artist_photos").delete().eq("id", p.id); await removePublic(p.url); loadArtists();
  });
  $("#arDel").onclick = async () => {
    if (!confirm(`Supprimer ${a.name}, ses morceaux, vidéos, photos et fichiers privés ? Cette action est définitive.`)) return;
    const paths = pkFiles.map((x) => x.storage_path);
    const { error } = await sb.from("floriqa_artists").delete().eq("id", a.id);
    if (error) return toast("Erreur : " + error.message, "err");
    for (const u of [a.card_url, a.photo_url, ...tracks.map((t) => t.audio_url), ...vids.map((v) => v.video_url), ...photos.map((p) => p.url)]) await removePublic(u);
    if (paths.length) await sb.storage.from(PK).remove(paths);
    arSel = null; $("#arDetail").innerHTML = `<p class="muted">Artiste supprimé.</p>`; loadArtists();
  };
  $$("#trList .file-row").forEach((row) => {
    const t = tracks.find((x) => x.id === row.dataset.id);
    $("[data-save]", row).onclick = async () => {
      const { error } = await sb.from("floriqa_tracks").update({ title: $("[data-title]", row).value }).eq("id", t.id);
      toast(error ? "Erreur." : "Titre enregistré.", error ? "err" : "ok");
    };
    $("[data-del]", row).onclick = async () => {
      if (!confirm(`Retirer « ${t.title} » ?`)) return;
      await sb.from("floriqa_tracks").delete().eq("id", t.id); await removePublic(t.audio_url); loadArtists();
    };
  });
  $$("#viList .file-row").forEach((row) => {
    const v = vids.find((x) => x.id === row.dataset.id);
    $("[data-del]", row).onclick = async () => {
      if (!confirm("Retirer cette vidéo ?")) return;
      await sb.from("floriqa_videos").delete().eq("id", v.id); await removePublic(v.video_url); loadArtists();
    };
  });
  $("#trAdd").onclick = async (e) => {
    const file = $("#trFile").files[0]; const title = $("#trTitle").value.trim() || file?.name.replace(/\.[^.]+$/, "");
    if (!file) return toast("Choisis un fichier audio.", "err");
    e.target.disabled = true; e.target.textContent = "Envoi…";
    const url = await uploadPublic(file, a.slug);
    if (url) {
      const { error } = await sb.from("floriqa_tracks").insert({ artist_id: a.id, title, audio_url: url, sort: (tracks.at(-1)?.sort || 0) + 1 });
      toast(error ? "Erreur : " + error.message : "Morceau ajouté.", error ? "err" : "ok");
    }
    loadArtists();
  };
  $("#viAdd").onclick = async (e) => {
    const file = $("#viFile").files[0];
    if (!file) return toast("Choisis un fichier vidéo.", "err");
    e.target.disabled = true; e.target.textContent = "Envoi…";
    const url = await uploadPublic(file, a.slug);
    if (url) {
      const { error } = await sb.from("floriqa_videos").insert({ artist_id: a.id, title: $("#viTitle").value || null, video_url: url, vertical: $("#viVert").value === "1", sort: (vids.at(-1)?.sort || 0) + 1 });
      toast(error ? "Erreur : " + error.message : "Vidéo ajoutée.", error ? "err" : "ok");
    }
    loadArtists();
  };

  // ----- lien privé -----
  const newToken = () => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  if (!pk) {
    $("#pkCreate").onclick = async () => {
      const { error } = await sb.from("floriqa_presskits").insert({ artist_id: a.id, token: newToken() });
      toast(error ? "Erreur : " + error.message : "Lien privé créé.", error ? "err" : "ok"); loadArtists();
    };
    return;
  }
  $("#pkCopy").onclick = async () => { await navigator.clipboard.writeText(pkLink).catch(() => $("#pkLink").select()); toast("Lien copié."); };
  $("#pkToggle").onclick = async () => {
    await sb.from("floriqa_presskits").update({ enabled: !pk.enabled, updated_at: new Date().toISOString() }).eq("artist_id", a.id);
    toast(pk.enabled ? "Lien désactivé." : "Lien réactivé."); loadArtists();
  };
  $("#pkRegen").onclick = async () => {
    if (!confirm("Créer un nouveau lien ? L'ancien lien ne marchera plus pour personne.")) return;
    await sb.from("floriqa_presskits").update({ token: newToken(), updated_at: new Date().toISOString() }).eq("artist_id", a.id);
    toast("Nouveau lien créé."); loadArtists();
  };
  $("#pkMsgSave").onclick = async () => {
    await sb.from("floriqa_presskits").update({ message: $("#pkMsg").value.trim() || null }).eq("artist_id", a.id);
    toast("Message enregistré.");
  };
  $$("#pkList .file-row").forEach((row) => {
    const x = pkFiles.find((y) => y.id === row.dataset.id);
    $("[data-dl]", row).onclick = async () => {
      const { data } = await sb.storage.from(PK).createSignedUrl(x.storage_path, 600, { download: x.name });
      if (data) location.href = data.signedUrl;
    };
    $("[data-del]", row).onclick = async () => {
      if (!confirm(`Retirer « ${x.name} » ?`)) return;
      await sb.storage.from(PK).remove([x.storage_path]);
      await sb.from("floriqa_presskit_files").delete().eq("id", x.id); loadArtists();
    };
  });
  $("#pkAdd").onclick = async () => {
    const files = [...$("#pkFile").files].filter((x) => !tooBig(x));
    if (!files.length) return toast("Choisis un ou plusieurs fichiers.", "err");
    const cat = $("#pkCat").value, bar = $("#pkProg i");
    $("#pkProg").classList.remove("hidden");
    let done = 0;
    for (const file of files) {
      bar.style.width = Math.round((done / files.length) * 100) + 5 + "%";
      const path = `${a.id}/${crypto.randomUUID()}-${safeName(file.name)}`;
      const { error } = await sb.storage.from(PK).upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (error) { toast(`Échec pour « ${file.name} » : ${error.message}`, "err"); continue; }
      await sb.from("floriqa_presskit_files").insert({ artist_id: a.id, category: cat, name: file.name, storage_path: path, size_bytes: file.size, sort: ++done });
    }
    toast(`${done} fichier(s) ajouté(s).`); loadArtists();
  };
}
function showArtist(id) {
  arSel = id;
  $$("#arList .list-item").forEach((x) => x.classList.toggle("sel", x.dataset.id === id));
  artistForm(artists.find((a) => a.id === id));
}

// =============== MEMBRES DE LA ROOM ===============
$("#invForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const { error } = await sb.from("floriqa_invites").upsert({
    email: f.get("email").trim().toLowerCase(), display_name: f.get("name").trim() || null, role: f.get("role"), artist_id: f.get("artist") || null,
  });
  if (error) return toast("Erreur : " + error.message, "err");
  e.target.reset(); toast("Accès donné. Envoie-lui le lien de la Room."); loadMembers();
});

async function loadMembers() {
  const [{ data: invs }, { data: reqs }, { data: mems }] = await Promise.all([
    sb.from("floriqa_invites").select("*").order("created_at"),
    sb.from("floriqa_access_requests").select("*").order("created_at"),
    sb.from("floriqa_members").select("*").order("role").order("display_name"),
  ]);
  $("#nReq").textContent = reqs?.length || "";
  const aName = (id) => artists.find((a) => a.id === id)?.name;
  const artistOpts = (sel) => `<option value="">— aucune fiche —</option>` + artists.map((a) => `<option value="${a.id}" ${a.id === sel ? "selected" : ""}>${esc(a.name)}</option>`).join("");
  const roleOpts = (sel) => Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${l}</option>`).join("");

  $("#invList").innerHTML = invs?.length ? `<p class="muted" style="margin:.8rem 0 .4rem">En attente de création de compte :</p>` + invs.map((i) => `
    <div class="file-row" data-id="${esc(i.email)}"><div><b>${esc(i.display_name || i.email)}</b> <span class="muted">${esc(i.email)} · ${ROLES[i.role]}${i.artist_id ? " · " + esc(aName(i.artist_id) || "") : ""}</span></div>
      <div class="actions"><button class="btn small danger" data-del>Annuler</button></div></div>`).join("") : "";
  $$("#invList .file-row").forEach((row) => $("[data-del]", row).onclick = async () => {
    await sb.from("floriqa_invites").delete().eq("email", row.dataset.id); loadMembers();
  });

  $("#reqList").innerHTML = reqs?.length ? reqs.map((r) => `
    <div class="file-row" data-id="${r.user_id}">
      <div><b>${esc(r.display_name)}</b> <span class="muted">${esc(r.email || "")} · ${fmtDate(r.created_at)}</span>
        ${r.message ? `<div class="muted" style="margin-top:.3rem">« ${esc(r.message)} »</div>` : ""}</div>
      <div class="actions">
        <select data-role style="width:auto">${roleOpts("artist")}</select>
        <select data-artist style="width:auto">${artistOpts(null)}</select>
        <button class="btn small primary" data-ok>Donner accès</button><button class="btn small danger" data-no>Refuser</button>
      </div>
    </div>`).join("") : `<p class="muted">Aucune demande en attente.</p>`;
  $$("#reqList .file-row").forEach((row) => {
    const uid = row.dataset.id;
    $("[data-ok]", row).onclick = async () => {
      const { error } = await sb.rpc("floriqa_approve", { p_user: uid, p_role: $("[data-role]", row).value, p_artist: $("[data-artist]", row).value || null });
      toast(error ? "Erreur : " + error.message : "Accès donné.", error ? "err" : "ok"); loadMembers();
    };
    $("[data-no]", row).onclick = async () => {
      if (!confirm("Refuser cette demande ?")) return;
      await sb.from("floriqa_access_requests").delete().eq("user_id", uid); loadMembers();
    };
  });

  $("#memList").innerHTML = (mems || []).map((m) => `
    <div class="file-row" data-id="${m.user_id}">
      <div><b>${esc(m.display_name)}</b> <span class="muted">${esc(m.email || "")}</span></div>
      <div class="actions">
        <select data-role style="width:auto" ${m.user_id === me.user_id ? "disabled" : ""}>${roleOpts(m.role)}</select>
        <select data-artist style="width:auto">${artistOpts(m.artist_id)}</select>
        <button class="btn small" data-save>Enregistrer</button>
        ${m.user_id === me.user_id ? "" : `<button class="btn small danger" data-del>Retirer l'accès</button>`}
      </div>
    </div>`).join("");
  $$("#memList .file-row").forEach((row) => {
    const uid = row.dataset.id;
    $("[data-save]", row).onclick = async () => {
      const upd = { artist_id: $("[data-artist]", row).value || null };
      if (uid !== me.user_id) upd.role = $("[data-role]", row).value;
      const { error } = await sb.from("floriqa_members").update(upd).eq("user_id", uid);
      toast(error ? "Erreur : " + error.message : "Membre mis à jour.", error ? "err" : "ok");
    };
    const del = $("[data-del]", row);
    if (del) del.onclick = async () => {
      if (!confirm("Retirer l'accès à la Room ? Cette personne ne pourra plus y entrer.")) return;
      await sb.from("floriqa_members").delete().eq("user_id", uid); loadMembers();
    };
  });
}

boot();
