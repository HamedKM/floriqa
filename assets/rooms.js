// Floriqa — Rooms (shared by the Artists panel and the Admin)
(function () {
  const { sb, esc, toast, fmtDate, fmtSize } = window.Floriqa;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const MAX = 50 * 1024 * 1024;
  const ROOM_BUCKET = "floriqa-room";
  const safeName = (n) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
  const AUDIO = /\.(mp3|wav|aiff?|flac|m4a|ogg|aac)$/i;
  const DAW = /\.(als|alp|logicx|flp|ptx|rpp|cpr|song|bwproject|zip|rar|7z)$/i;
  const kindOf = (n) => (AUDIO.test(n) ? "audio" : DAW.test(n) ? "daw" : "other");
  const KIND = { audio: "🎧 Audio", daw: "🎛️ Project", other: "📎 File" };

  // ctx: { user, myEmail(), myName(), defaultArtists() }
  window.Floriqa.mountRooms = function (ctx) {
    let user = ctx.user;
    const me = { get email() { return ctx.myEmail(); } };
    const myName = () => ctx.myName();
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

async function artistPicker(selected = []) {
  const { data } = await sb.rpc("floriqa_room_directory");
  return `<div style="max-height:260px;overflow:auto;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:.4rem .7rem">${(data || []).map((a) =>
    `<label class="chk"><input type="checkbox" name="artists" value="${a.id}" ${selected.includes(a.id) ? "checked" : ""}> ${esc(a.name)}</label>`).join("") || `<span class="muted">No artists yet.</span>`}</div>`;
}

async function newRoom() {
  roomSel = null; loadRooms();
  $("#roomView").innerHTML = `
    <h3 style="margin-bottom:1rem">New room</h3>
    <form id="nrForm">
      <label class="field"><span>Name</span><input type="text" name="title" required maxlength="120" placeholder="e.g. Summer EP, Kolok x Saray remix…"></label>
      <label class="field"><span>Description</span><textarea name="description" maxlength="2000"></textarea></label>
      <div class="field"><span>Invite artists (their artist members get access — never their team)</span>${await artistPicker(ctx.defaultArtists())}</div>
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

    $("#newRoom").onclick = newRoom;
    return { load: loadRooms };
  };
})();
