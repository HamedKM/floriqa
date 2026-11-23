// Floriqa — Room d'échange privée (projets, fichiers audio / DAW, commentaires)
const { sb, esc, buildChrome, toast, fmtDate, fmtSize } = Floriqa;
buildChrome({ active: "Room", video: false });

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const show = (id) => ["auth", "pending", "room"].forEach((x) => $("#" + x).classList.toggle("hidden", x !== id));
const BUCKET = "floriqa-room";
const MAX = 50 * 1024 * 1024;
const STATUSES = ["idée", "en cours", "mix", "master", "terminé"];
const AUDIO = /\.(mp3|wav|aiff?|flac|m4a|ogg|aac)$/i;
const DAW = /\.(als|alp|logicx|flp|ptx|rpp|cpr|song|bwproject|zip|rar|7z)$/i;
const kindOf = (n) => (AUDIO.test(n) ? "audio" : DAW.test(n) ? "daw" : "other");
const KIND = { audio: "🎧 Audio", daw: "🎛️ Projet DAW", other: "📎 Fichier" };
const safeName = (n) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);

let me = null, user = null, members = {}, projects = [], current = null;
// une seule lecture audio à la fois
$("#pView").addEventListener("play", (e) => $$("#pView audio").forEach((m) => m !== e.target && m.pause()), true);

// ---------- connexion / inscription ----------
$$("[data-auth]").forEach((t) => t.addEventListener("click", () => {
  $$("[data-auth]").forEach((x) => x.classList.toggle("active", x === t));
  $("#inForm").classList.toggle("hidden", t.dataset.auth !== "in");
  $("#upForm").classList.toggle("hidden", t.dataset.auth !== "up");
}));
$("#inForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const { error } = await sb.auth.signInWithPassword({ email: f.get("email"), password: f.get("password") });
  if (error) return toast(/confirm/i.test(error.message) ? "Confirme d'abord ton e-mail (regarde ta boîte de réception)." : "E-mail ou mot de passe incorrect.", "err");
  boot();
});
$("#forgot").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = $("#inForm").email.value.trim();
  if (!email) return toast("Écris d'abord ton e-mail dans le champ.", "err");
  await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  toast("Si ce compte existe, un e-mail de réinitialisation a été envoyé.");
});
$("#upForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const name = f.get("name").trim(), message = f.get("message").trim() || null;
  const { data, error } = await sb.auth.signUp({
    email: f.get("email").trim(), password: f.get("password"),
    options: { data: { display_name: name, floriqa_message: message }, emailRedirectTo: location.origin + location.pathname },
  });
  if (error) return toast(error.message, "err");
  if (data.session) { user = data.user; await requestAccess(name, message); return boot(); }
  show("pending");
  $("#pendingText").textContent = "Un e-mail de confirmation vient de t'être envoyé. Clique sur le lien qu'il contient, puis reviens te connecter ici : ta demande sera alors transmise à l'équipe.";
});
$$("[data-logout]").forEach((b) => b.addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); }));

async function requestAccess(name, message) {
  const { error } = await sb.from("floriqa_access_requests").insert({ user_id: user?.id || (await sb.auth.getUser()).data.user.id, display_name: name, email: user?.email || null, message });
  if (error && error.code !== "23505") toast("Erreur : " + error.message, "err");
}
$("#reqForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  await requestAccess(f.get("name").trim(), f.get("message").trim() || null);
  boot();
});

// changement de mot de passe après le lien « mot de passe oublié »
sb.auth.onAuthStateChange(async (event) => {
  if (event === "PASSWORD_RECOVERY") {
    const pw = prompt("Choisis ton nouveau mot de passe (8 caractères minimum) :");
    if (pw && pw.length >= 8) {
      const { error } = await sb.auth.updateUser({ password: pw });
      toast(error ? "Erreur : " + error.message : "Mot de passe changé.", error ? "err" : "ok");
    }
  }
});

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session || session.user.is_anonymous) return show("auth");
  user = session.user;
  const { data: m } = await sb.from("floriqa_members").select("*").eq("user_id", user.id).maybeSingle();
  if (!m) {
    const { data: r } = await sb.from("floriqa_access_requests").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!r && user.user_metadata?.display_name) {
      // inscription confirmée par e-mail : on transmet la demande automatiquement
      await requestAccess(user.user_metadata.display_name, user.user_metadata.floriqa_message || null);
      return boot();
    }
    show("pending");
    $("#reqForm").classList.toggle("hidden", !!r);
    $("#pendingText").textContent = r ? "Ta demande est bien arrivée. Un admin doit valider ton accès : reviens sur cette page un peu plus tard." : "Ce compte n'a pas encore accès à la Room. Envoie une demande :";
    return;
  }
  me = m;
  $("#who").textContent = `${m.display_name} · ${{ admin: "Admin", team: "Équipe", artist: "Artiste" }[m.role]}`;
  $("#adminLink").classList.toggle("hidden", m.role !== "admin");
  show("room");
  const { data: mems } = await sb.from("floriqa_members").select("user_id,display_name");
  members = Object.fromEntries((mems || []).map((x) => [x.user_id, x.display_name]));
  await loadProjects();
  const want = new URLSearchParams(location.search).get("p");
  if (want && projects.some((p) => p.id === want)) openProject(want);
}
const nameOf = (uid) => esc(members[uid] || "Ancien membre");
const canEdit = (owner) => owner === user.id || me.role === "admin";

// ---------- projets ----------
async function loadProjects() {
  const { data, error } = await sb.from("floriqa_projects").select("*, floriqa_files(count)").order("updated_at", { ascending: false });
  if (error) return toast("Impossible de charger les projets.", "err");
  projects = data;
  renderProjects();
}
function renderProjects() {
  const q = $("#pSearch").value.trim().toLowerCase();
  const list = projects.filter((p) => !q || (p.title + " " + (p.description || "")).toLowerCase().includes(q));
  $("#pList").innerHTML = list.length ? list.map((p) => `
    <div class="list-item ${current === p.id ? "sel" : ""}" data-id="${p.id}">
      <div><b>${esc(p.title)}</b><div class="muted">${nameOf(p.created_by)} · ${p.floriqa_files?.[0]?.count || 0} fichier(s)</div></div>
      <span class="badge">${esc(p.status)}</span>
    </div>`).join("") : `<p class="muted">Aucun projet pour l'instant.</p>`;
  $$("#pList .list-item").forEach((el) => el.addEventListener("click", () => openProject(el.dataset.id)));
}
$("#pSearch").addEventListener("input", renderProjects);

$("#newProject").addEventListener("click", () => {
  current = null; renderProjects();
  $("#pView").innerHTML = `
    <h3 style="margin-bottom:1rem">Nouveau projet</h3>
    <form id="npForm">
      <label class="field"><span>Titre</span><input type="text" name="title" required maxlength="120" placeholder="ex. EP été 2027, remix Kolok x Saray…"></label>
      <label class="field"><span>Description</span><textarea name="description" maxlength="2000" placeholder="Idée, BPM, tonalité, qui fait quoi…"></textarea></label>
      <label class="field"><span>Étape</span><select name="status">${STATUSES.map((s) => `<option ${s === "en cours" ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <button class="btn primary" type="submit">Créer le projet</button>
    </form>`;
  $("#npForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { data, error } = await sb.from("floriqa_projects").insert({ title: f.get("title").trim(), description: f.get("description").trim() || null, status: f.get("status"), created_by: user.id }).select().single();
    if (error) return toast("Erreur : " + error.message, "err");
    await loadProjects(); openProject(data.id);
  });
});

async function openProject(id) {
  current = id; renderProjects();
  history.replaceState(null, "", "?p=" + id);
  const p = projects.find((x) => x.id === id);
  if (!p) return;
  const [{ data: files }, { data: comments }] = await Promise.all([
    sb.from("floriqa_files").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    sb.from("floriqa_comments").select("*").eq("project_id", id).order("created_at"),
  ]);
  const own = canEdit(p.created_by);
  const fileName = Object.fromEntries((files || []).map((f) => [f.id, f.name]));

  $("#pView").innerHTML = `
    <div class="toolbar">
      <h3 class="grow">${esc(p.title)}</h3>
      ${own ? `<select id="pStatus" style="width:auto">${STATUSES.map((s) => `<option ${s === p.status ? "selected" : ""}>${s}</option>`).join("")}</select>` : `<span class="badge">${esc(p.status)}</span>`}
      ${own ? `<button class="btn small" id="pEdit">Modifier</button><button class="btn small danger" id="pDel">Supprimer</button>` : ""}
    </div>
    <p class="muted">Créé par ${nameOf(p.created_by)} · mis à jour le ${fmtDate(p.updated_at)}</p>
    ${p.description ? `<p style="margin:.8rem 0;white-space:pre-wrap;line-height:1.5">${esc(p.description)}</p>` : ""}
    <hr class="sep">
    <h3 style="margin-bottom:.8rem">Fichiers</h3>
    <div class="drop" id="drop">
      <b>Glisse tes fichiers ici</b> ou clique pour choisir<br>
      <span class="muted">Audio (mp3, wav, aiff, flac…), projets DAW zippés (Ableton, Logic, FL…) · 50 Mo max par fichier</span>
      <input type="file" id="fileInput" multiple hidden>
      <div class="progress hidden" id="prog"><i></i></div>
    </div>
    <input type="text" id="fileNote" placeholder="Note pour cet envoi (ex. « v2 avec nouvelle basse »)" style="margin:.6rem 0 1rem">
    <div id="files">${(files || []).map((f) => `
      <div class="file-row" data-id="${f.id}">
        <div><b>${esc(f.name)}</b> <span class="muted">· ${KIND[f.kind]} · ${fmtSize(f.size_bytes)} · ${nameOf(f.uploaded_by)} · ${fmtDate(f.created_at)}</span>
          ${f.note ? `<div class="muted" style="margin-top:.2rem">${esc(f.note)}</div>` : ""}</div>
        <div class="actions">
          <button class="btn small" data-dl>Télécharger</button>
          <button class="btn small" data-cm>Commenter</button>
          ${canEdit(f.uploaded_by) ? `<button class="btn small danger" data-del>×</button>` : ""}
        </div>
        ${f.kind === "audio" ? `<audio controls preload="none" data-path="${esc(f.storage_path)}"></audio>` : ""}
      </div>`).join("") || `<p class="muted">Aucun fichier pour l'instant.</p>`}</div>
    <hr class="sep">
    <h3 style="margin-bottom:.8rem">Discussion</h3>
    <div id="comments">${(comments || []).map((c) => `
      <div class="comment">
        <div class="meta"><span><b>${nameOf(c.author)}</b>${c.file_id ? ` · à propos de <i>${esc(fileName[c.file_id] || "un fichier supprimé")}</i>` : ""}</span>
          <span>${fmtDate(c.created_at)} ${canEdit(c.author) ? `<a href="#" data-cdel="${c.id}" class="muted">supprimer</a>` : ""}</span></div>
        <div class="body">${esc(c.body)}</div>
      </div>`).join("") || `<p class="muted">Pas encore de message.</p>`}</div>
    <form id="cForm" style="margin-top:.8rem">
      <div class="muted hidden" id="cAbout" style="margin-bottom:.4rem"></div>
      <textarea name="body" required maxlength="4000" placeholder="Écris un commentaire, un retour sur le mix, une idée…"></textarea>
      <div class="toolbar" style="margin-top:.5rem"><button class="btn primary" type="submit">Envoyer</button></div>
    </form>`;

  // statut / édition / suppression
  if (own) {
    $("#pStatus").onchange = async (e) => { await sb.from("floriqa_projects").update({ status: e.target.value }).eq("id", id); p.status = e.target.value; renderProjects(); };
    $("#pEdit").onclick = async () => {
      const title = prompt("Titre du projet :", p.title); if (title === null || !title.trim()) return;
      const description = prompt("Description :", p.description || ""); if (description === null) return;
      await sb.from("floriqa_projects").update({ title: title.trim(), description: description.trim() || null }).eq("id", id);
      await loadProjects(); openProject(id);
    };
    $("#pDel").onclick = async () => {
      if (!confirm(`Supprimer « ${p.title} », tous ses fichiers et commentaires ? C'est définitif.`)) return;
      const paths = (files || []).map((f) => f.storage_path);
      if (paths.length) await sb.storage.from(BUCKET).remove(paths);
      const { error } = await sb.from("floriqa_projects").delete().eq("id", id);
      if (error) return toast("Erreur : " + error.message, "err");
      current = null; history.replaceState(null, "", location.pathname);
      $("#pView").innerHTML = `<p class="muted">Projet supprimé.</p>`; loadProjects();
    };
  }

  // lecteurs audio : lien sécurisé à la demande
  $$("#files audio").forEach((a) => a.addEventListener("play", async () => {
    if (a.dataset.ready) return;
    const { data } = await sb.storage.from(BUCKET).createSignedUrl(a.dataset.path, 3600);
    if (data) { a.src = data.signedUrl; a.dataset.ready = 1; a.play(); }
  }, { once: false }));

  let aboutFile = null;
  $$("#files .file-row").forEach((row) => {
    const f = files.find((x) => x.id === row.dataset.id);
    $("[data-dl]", row).onclick = async () => {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(f.storage_path, 600, { download: f.name });
      if (error) return toast("Erreur de téléchargement.", "err");
      location.href = data.signedUrl;
    };
    $("[data-cm]", row).onclick = () => {
      aboutFile = f.id;
      $("#cAbout").innerHTML = `À propos de <b>${esc(f.name)}</b> · <a href="#" id="cAboutX">annuler</a>`;
      $("#cAbout").classList.remove("hidden");
      $("#cAboutX").onclick = (e) => { e.preventDefault(); aboutFile = null; $("#cAbout").classList.add("hidden"); };
      $("#cForm textarea").focus();
    };
    const del = $("[data-del]", row);
    if (del) del.onclick = async () => {
      if (!confirm(`Supprimer « ${f.name} » ?`)) return;
      await sb.storage.from(BUCKET).remove([f.storage_path]);
      await sb.from("floriqa_files").delete().eq("id", f.id);
      await loadProjects(); openProject(id);
    };
  });
  $$("[data-cdel]").forEach((a) => a.onclick = async (e) => {
    e.preventDefault();
    await sb.from("floriqa_comments").delete().eq("id", a.dataset.cdel); openProject(id);
  });

  $("#cForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = e.target.body.value.trim(); if (!body) return;
    const { error } = await sb.from("floriqa_comments").insert({ project_id: id, file_id: aboutFile, body, author: user.id });
    if (error) return toast("Erreur : " + error.message, "err");
    await loadProjects(); openProject(id);
  });

  // envoi de fichiers
  const drop = $("#drop"), input = $("#fileInput");
  drop.onclick = (e) => { if (e.target === drop || e.target.tagName !== "INPUT") input.click(); };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); upload([...e.dataTransfer.files]); };
  input.onchange = () => upload([...input.files]);

  async function upload(list) {
    const ok = list.filter((f) => {
      if (f.size > MAX) { toast(`« ${f.name} » dépasse 50 Mo. Zippe-le ou exporte une version plus légère.`, "err"); return false; }
      return true;
    });
    if (!ok.length) return;
    const prog = $("#prog"), bar = $("#prog i");
    prog.classList.remove("hidden");
    const note = $("#fileNote").value.trim() || null;
    let done = 0;
    for (const f of ok) {
      bar.style.width = Math.round((done / ok.length) * 100) + 5 + "%";
      const path = `${id}/${crypto.randomUUID()}-${safeName(f.name)}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || "application/octet-stream" });
      if (error) { toast(`Échec pour « ${f.name} » : ${error.message}`, "err"); continue; }
      const { error: e2 } = await sb.from("floriqa_files").insert({ project_id: id, name: f.name, kind: kindOf(f.name), storage_path: path, size_bytes: f.size, note, uploaded_by: user.id });
      if (e2) { await sb.storage.from(BUCKET).remove([path]); toast("Erreur : " + e2.message, "err"); continue; }
      done++;
    }
    bar.style.width = "100%";
    toast(`${done} fichier(s) envoyé(s).`);
    await loadProjects(); openProject(id);
  }
}

boot();
