// Floriqa — éléments communs à toutes les pages (menu, vidéo, connexion base)
(function () {
  const cfg = window.FLORIQA_CONFIG;
  const BASE = window.FLQ_BASE || "";
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const media = (u) => (!u ? "" : /^https?:\/\//.test(u) ? u : BASE + u);

  const NAV = [
    ["Garden", "index.html"],
    ["Artists", "artists.html"],
    ["Affair", "affair.html"],
  ];

  function buildChrome(opts = {}) {
    const here = opts.active || "";
    if (opts.video !== false) {
      const wrap = document.createElement("div");
      wrap.className = "video-bg" + (opts.negative ? " negative" : "");
      const mobile = window.matchMedia("(max-width: 767px)").matches;
      const src = BASE + (mobile ? "videos/garden-mobile-light.mp4" : "videos/garden-desktop-light.mp4");
      wrap.innerHTML = `<video autoplay loop muted playsinline poster="${BASE}videos/garden-poster.jpg"><source src="${src}" type="video/mp4"></video><div class="video-shade"></div>`;
      document.body.prepend(wrap);
    }
    const links = NAV.map(([t, h]) => `<a href="${BASE}${h}" class="${t === here ? "active" : ""}">${t}</a>`).join("");
    const nav = document.createElement("header");
    nav.className = "navbar";
    nav.innerHTML = `
      <a class="logo-phrase" href="${BASE}index.html" aria-label="Floriqa — accueil"></a>
      <nav class="nav-links">${links}</nav>
      <button class="burger" aria-label="Menu"><span></span><span></span><span></span></button>`;
    document.body.prepend(nav);
    const menu = document.createElement("div");
    menu.className = "mobile-menu";
    menu.innerHTML = links;
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    document.body.append(overlay, menu);

    const logo = nav.querySelector(".logo-phrase");
    (cfg.logoLines || ["FLORIQA"]).forEach((line) => {
      const l = document.createElement("div");
      [...line].forEach((ch) => {
        const s = document.createElement("span");
        s.textContent = ch;
        s.style.animationDelay = `${Math.random() * 2}s`;
        l.appendChild(s);
      });
      logo.appendChild(l);
    });

    const burger = nav.querySelector(".burger");
    const close = () => { menu.classList.remove("show"); overlay.classList.remove("show"); burger.classList.remove("hidden"); };
    burger.addEventListener("click", () => { burger.classList.add("hidden"); menu.classList.add("show"); overlay.classList.add("show"); });
    overlay.addEventListener("click", close);
    menu.addEventListener("click", close);
  }

  function toast(msg, type = "ok") {
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 400); }, 3500);
  }

  const fmtSize = (b) => (b == null ? "" : b > 1048576 ? (b / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(b / 1024)) + " Ko");
  const fmtDate = (d) => new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  // envoi des e-mails des conversations (service "floriqa-mail")
  async function mail(payload) {
    try {
      const { data, error } = await sb.functions.invoke("floriqa-mail", { body: payload });
      return error ? { ok: false, error: error.message } : data;
    } catch (e) { return { ok: false, error: String(e) }; }
  }

  window.Floriqa = { sb, esc, media, BASE, cfg, buildChrome, toast, fmtSize, fmtDate, mail };
})();

// Lien vers le formulaire de booking avec l'artiste pré-rempli
// avec le slug : /book/<slug>/ (l'aperçu du lien montre la photo de l'artiste, puis ouvre le formulaire)
window.Floriqa.bookingUrl = (name, slug) => new URL(slug ? `book/${slug}/` : `affair.html?artist=${encodeURIComponent(name)}`, new URL(window.Floriqa.BASE || "./", location.href)).href;
window.Floriqa.copyText = async (t) => { try { await navigator.clipboard.writeText(t); window.Floriqa.toast("Link copied."); } catch { prompt("Copy this link:", t); } };

// Fenêtre de confirmation (verre noir) — renvoie true / false
window.Floriqa.confirmBox = ({ title, text, ok = "Confirm", cancel = "Cancel" }, preview) => new Promise((resolve) => {
  const esc = window.Floriqa.esc;
  const wrap = document.createElement("div");
  wrap.className = "confirm-overlay";
  wrap.innerHTML = `<div class="card confirm-box" role="dialog" aria-modal="true">
    <h3>${title}</h3><p style="margin:.7rem 0">${text}</p>
    ${preview ? `<div class="confirm-preview">${esc(preview)}</div>` : ""}
    <div class="toolbar" style="justify-content:flex-end;margin-top:1rem"><button class="btn" data-no>${esc(cancel)}</button><button class="btn primary" data-yes>${esc(ok)}</button></div></div>`;
  const done = (v) => { wrap.remove(); document.removeEventListener("keydown", key); resolve(v); };
  const key = (e) => { if (e.key === "Escape") done(false); };
  wrap.querySelector("[data-no]").onclick = () => done(false);
  wrap.querySelector("[data-yes]").onclick = () => done(true);
  wrap.onclick = (e) => { if (e.target === wrap) done(false); };
  document.addEventListener("keydown", key);
  document.body.appendChild(wrap);
  wrap.querySelector("[data-yes]").focus();
});
