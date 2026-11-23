// Floriqa — panneau admin
const { sb, esc, media, buildChrome, toast, fmtDate, fmtSize } = Floriqa;
buildChrome({ video: false });

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const show = (id) => ["login", "denied", "panel"].forEach((x) => $("#" + x).classList.toggle("hidden", x !== id));
const MAX = 50 * 1024 * 1024;
const PUB = "floriqa-public";
const STATUS = { new: "Nouvelle", in_progress: "En cours", accepted: "Acceptée", declined: "Refusée", archived: "Archivée" };
const ROLES = { admin: "Admin", team: "Équipe", artist: "Artiste" };
let me = null;

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
  const { data: m } = await sb.from("floriqa_members").select("*").eq("user_id", session.user.id).maybeSingle();
  if (!m || m.role !== "admin") return show("denied");
  me = m;
  $("#who").textContent = m.display_name;
  show("panel");
  loadBookings();
  await loadArtists();
  loadMembers();
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
  const { data, error } = await sb.from("floriqa_bookings").select("*").order("created_at", { ascending: false });
  if (error) return toast("Impossible de charger les bookings.", "err");
  bookings = data;
  const c = (s) => data.filter((b) => b.status === s).length;
  $("#nNew").textContent = c("new") || "";
  $("#bkStats").innerHTML = [["new", "Nouvelles"], ["in_progress", "En cours"], ["accepted", "Acceptées"], ["declined", "Refusées"]]
    .map(([k, l]) => `<div class="stat"><b>${c(k)}</b><span class="muted">${l}</span></div>`).join("");
  renderBookings();
  if (bkSel) showBooking(bkSel);
}
function renderBookings() {
  const f = $("#bkFilter").value;
  const q = $("#bkSearch").value.trim().toLowerCase();
  const list = bookings.filter((b) =>
    (f === "all" || (f === "open" ? ["new", "in_progress"].includes(b.status) : b.status === f)) &&
    (!q || [b.artist_name, b.event, b.organization, b.promoter, b.city, b.country].join(" ").toLowerCase().includes(q)));
  $("#bkList").innerHTML = list.length ? list.map((b) => `
    <div class="list-item ${b.id === bkSel ? "sel" : ""}" data-id="${b.id}">
      <div><b>${esc(b.artist_name)}</b> · ${esc(b.event)}<div class="muted">${esc(b.city)} · ${esc(b.dates)}</div></div>
      <span class="badge ${b.status}">${STATUS[b.status]}</span>
    </div>`).join("") : `<p class="muted">Aucune demande.</p>`;
  $$("#bkList .list-item").forEach((el) => el.addEventListener("click", () => showBooking(el.dataset.id)));
}
$("#bkFilter").addEventListener("change", renderBookings);
$("#bkSearch").addEventListener("input", renderBookings);
$("#bkRefresh").addEventListener("click", loadBookings);

function showBooking(id) {
  bkSel = id;
  renderBookings();
  const b = bookings.find((x) => x.id === id);
  if (!b) return;
  const yn = (v, d) => (v ? `Oui${d ? " — " + esc(d) : ""}` : "Non");
  const rows = [
    ["Reçue le", fmtDate(b.created_at)], ["Artiste", esc(b.artist_name)], ["Organisation", esc(b.organization)], ["Organisateur", esc(b.promoter)],
    ["Téléphone", `<a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>`], ["E-mail", `<a href="mailto:${esc(b.email)}">${esc(b.email)}</a>`],
    ["Événement", esc(b.event)], ["Lieu", esc(b.venue)], ["Date(s)", esc(b.dates)], ["Line-up", esc(b.lineup)],
    ["Ville / Pays", `${esc(b.city)}, ${esc(b.country)}`],
    ["Réseau social", b.social_link ? `<a target="_blank" rel="noopener" href="${esc(/^https?:/.test(b.social_link) ? b.social_link : "https://" + b.social_link)}">${esc(b.social_link)}</a>` : "—"],
    ["B2B", esc(b.b2b || "Non")], ["Durée", esc(b.duration)], ["Horaire", esc(b.perf_time)], ["Cachet net", `<b>${esc(b.fee)} €</b>`],
    ["Transport", yn(b.transport, b.transport_details)], ["Hébergement", yn(b.accommodation, b.accommodation_details)], ["Hospitalité", yn(b.hospitality, b.hospitality_details)],
  ];
  const subject = encodeURIComponent(`Floriqa – ${b.artist_name} @ ${b.event}`);
  $("#bkDetail").innerHTML = `
    <div class="toolbar"><h3 class="grow">${esc(b.artist_name)} · ${esc(b.event)}</h3><span class="badge ${b.status}">${STATUS[b.status]}</span></div>
    <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    <hr class="sep">
    <label class="field"><span>Statut</span>
      <select id="bkStatus">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${k === b.status ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="field"><span>Notes internes (visibles seulement par les admins)</span><textarea id="bkNotes">${esc(b.admin_notes || "")}</textarea></label>
    <div class="toolbar">
      <button class="btn primary" id="bkSave">Enregistrer</button>
      <a class="btn" href="mailto:${esc(b.email)}?subject=${subject}">Répondre par e-mail</a>
      <span class="grow"></span>
      <button class="btn danger" id="bkDel">Supprimer</button>
    </div>`;
  $("#bkSave").onclick = async () => {
    const { error } = await sb.from("floriqa_bookings").update({ status: $("#bkStatus").value, admin_notes: $("#bkNotes").value || null }).eq("id", id);
    if (error) return toast("Erreur d'enregistrement.", "err");
    toast("Demande mise à jour."); loadBookings();
  };
  $("#bkDel").onclick = async () => {
    if (!confirm("Supprimer définitivement cette demande ?")) return;
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
    .select("*, floriqa_tracks(*), floriqa_videos(*)").order("sort").order("name");
  if (error) return toast("Impossible de charger les artistes.", "err");
  artists = data;
  $("#arList").innerHTML = data.map((a) => `
    <div class="list-item ${a.id === arSel ? "sel" : ""}" data-id="${a.id}">
      <div style="display:flex;gap:.7rem;align-items:center">
        ${(a.card_url || a.photo_url) ? `<img class="thumb" src="${esc(media(a.card_url || a.photo_url))}" alt="">` : `<div class="thumb"></div>`}
        <div><b>${esc(a.name)}</b><div class="muted">${esc(a.tagline || "")}</div></div>
      </div>
      ${a.published ? "" : `<span class="badge">Masqué</span>`}
    </div>`).join("");
  $$("#arList .list-item").forEach((el) => el.addEventListener("click", () => showArtist(el.dataset.id)));
  if (arSel) showArtist(arSel);
}
const slugify = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const safeName = (n) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);

async function uploadPublic(file, slug) {
  if (file.size > MAX) { toast(`« ${file.name} » dépasse 50 Mo (limite de l'offre gratuite).`, "err"); return null; }
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
  const tracks = (a.floriqa_tracks || []).sort((x, y) => x.sort - y.sort);
  const vids = (a.floriqa_videos || []).sort((x, y) => x.sort - y.sort);
  $("#arDetail").innerHTML = `
    <div class="toolbar"><h3 class="grow">${isNew ? "Nouvel artiste" : esc(a.name)}</h3>
      ${isNew ? "" : `<a class="btn small" target="_blank" href="../artist.html?a=${esc(a.slug)}">Voir la page ↗</a>`}</div>
    <form id="arForm">
      <div class="row2">
        <label class="field"><span>Nom</span><input type="text" name="name" required value="${esc(a.name)}"></label>
        <label class="field"><span>Adresse de la page (ex. kolok)</span><input type="text" name="slug" required pattern="[a-z0-9-]+" value="${esc(a.slug)}"></label>
      </div>
      <div class="row2">
        <label class="field"><span>Sous-titre (ex. DJ & Producer)</span><input type="text" name="tagline" value="${esc(a.tagline || "")}"></label>
        <label class="field"><span>Lien Instagram</span><input type="url" name="instagram" value="${esc(a.instagram || "")}"></label>
      </div>
      <label class="field"><span>Biographie</span><textarea name="bio">${esc(a.bio || "")}</textarea></label>
      <div class="row2">
        <label class="field"><span>Ordre d'affichage</span><input type="number" name="sort" value="${a.sort}"></label>
        <label class="field"><span>Visible sur le site</span><select name="published"><option value="1" ${a.published ? "selected" : ""}>Oui</option><option value="0" ${a.published ? "" : "selected"}>Non (masqué)</option></select></label>
      </div>
      ${isNew ? "" : `
      <div class="row2">
        <div class="field"><span>Photo carrée (liste des artistes)</span>
          ${a.card_url ? `<img class="thumb" style="width:90px;height:90px;margin-bottom:.4rem" src="${esc(media(a.card_url))}">` : ""}
          <input type="file" accept="image/*" data-up="card_url"></div>
        <div class="field"><span>Photo de la page artiste</span>
          ${a.photo_url ? `<img class="thumb" style="width:90px;height:90px;margin-bottom:.4rem" src="${esc(media(a.photo_url))}">` : ""}
          <input type="file" accept="image/*" data-up="photo_url"></div>
      </div>`}
      <div class="toolbar"><button class="btn primary" type="submit">${isNew ? "Créer l'artiste" : "Enregistrer"}</button>
        <span class="grow"></span>${isNew ? "" : `<button class="btn danger" type="button" id="arDel">Supprimer l'artiste</button>`}</div>
    </form>
    ${isNew ? "" : `
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
    <p class="muted">Limite : 50 Mo par fichier. Pour une vidéo plus lourde, compresse-la d'abord (ex. avec HandBrake).</p>`}
  `;
  const form = $("#arForm");
  form.name.addEventListener("input", () => { if (isNew) form.slug.value = slugify(form.name.value); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const row = { name: f.get("name").trim(), slug: slugify(f.get("slug")), tagline: f.get("tagline") || null, bio: f.get("bio") || null,
      instagram: f.get("instagram") || null, sort: +f.get("sort") || 0, published: f.get("published") === "1" };
    const q = isNew ? sb.from("floriqa_artists").insert(row).select().single() : sb.from("floriqa_artists").update(row).eq("id", a.id).select().single();
    const { data, error } = await q;
    if (error) return toast(error.code === "23505" ? "Cette adresse de page existe déjà." : "Erreur : " + error.message, "err");
    toast(isNew ? "Artiste créé. Ajoute maintenant ses photos et morceaux." : "Artiste enregistré.");
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
  $("#arDel").onclick = async () => {
    if (!confirm(`Supprimer ${a.name} et tous ses morceaux et vidéos ? Cette action est définitive.`)) return;
    const { error } = await sb.from("floriqa_artists").delete().eq("id", a.id);
    if (error) return toast("Erreur : " + error.message, "err");
    for (const u of [a.card_url, a.photo_url, ...tracks.map((t) => t.audio_url), ...vids.map((v) => v.video_url)]) await removePublic(u);
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
}
function showArtist(id) {
  arSel = id;
  $$("#arList .list-item").forEach((x) => x.classList.toggle("sel", x.dataset.id === id));
  artistForm(artists.find((a) => a.id === id));
}

// =============== MEMBRES ===============
async function loadMembers() {
  const [{ data: reqs }, { data: mems }] = await Promise.all([
    sb.from("floriqa_access_requests").select("*").order("created_at"),
    sb.from("floriqa_members").select("*").order("role").order("display_name"),
  ]);
  $("#nReq").textContent = reqs?.length || "";
  const artistOpts = (sel) => `<option value="">— aucun —</option>` + artists.map((a) => `<option value="${a.id}" ${a.id === sel ? "selected" : ""}>${esc(a.name)}</option>`).join("");
  const roleOpts = (sel) => Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${l}</option>`).join("");

  $("#reqList").innerHTML = reqs?.length ? reqs.map((r) => `
    <div class="file-row" data-id="${r.user_id}">
      <div><b>${esc(r.display_name)}</b> <span class="muted">${esc(r.email || "")} · ${fmtDate(r.created_at)}</span>
        ${r.message ? `<div class="muted" style="margin-top:.3rem">« ${esc(r.message)} »</div>` : ""}</div>
      <div class="actions">
        <select data-role style="width:auto">${roleOpts("artist")}</select>
        <select data-artist style="width:auto" title="Fiche artiste liée">${artistOpts(null)}</select>
        <button class="btn small primary" data-ok>Accepter</button><button class="btn small danger" data-no>Refuser</button>
      </div>
    </div>`).join("") : `<p class="muted">Aucune demande en attente.</p>`;
  $$("#reqList .file-row").forEach((row) => {
    const uid = row.dataset.id;
    $("[data-ok]", row).onclick = async () => {
      const { error } = await sb.rpc("floriqa_approve", { p_user: uid, p_role: $("[data-role]", row).value, p_artist: $("[data-artist]", row).value || null });
      toast(error ? "Erreur : " + error.message : "Membre accepté.", error ? "err" : "ok"); loadMembers();
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
        ${m.user_id === me.user_id ? "" : `<button class="btn small danger" data-del>Retirer</button>`}
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
      if (!confirm("Retirer ce membre de la Room ? Il ne pourra plus y accéder.")) return;
      await sb.from("floriqa_members").delete().eq("user_id", uid); loadMembers();
    };
  });
}

boot();
