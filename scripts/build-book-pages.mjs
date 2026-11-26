// Génère une page par artiste : /book/<slug>/
// Elle porte la photo et le nom de l'artiste pour l'aperçu des liens (WhatsApp, Instagram, Messenger…)
// puis ouvre aussitôt le formulaire de booking pré-rempli.
// Usage : node scripts/build-book-pages.mjs            (lit les artistes dans Supabase)
//         node scripts/build-book-pages.mjs data.json  (lit une liste d'artistes en JSON)
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";

const SITE = "https://floriqa.xyz";
const cfg = readFileSync(new URL("../assets/config.js", import.meta.url), "utf8");
const pick = (k) => cfg.match(new RegExp(`${k}\\s*:\\s*["']([^"']+)`))?.[1];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let artists;
if (process.argv[2]) artists = JSON.parse(readFileSync(process.argv[2], "utf8"));
else {
  const url = `${pick("supabaseUrl")}/rest/v1/floriqa_artists?select=name,slug,tagline,card_url,photo_url&published=eq.true&order=sort,name`;
  const key = pick("supabaseKey");
  const r = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  artists = await r.json();
}

const dir = new URL("../book/", import.meta.url);
if (existsSync(dir)) for (const d of readdirSync(dir)) if (d !== "index.html") rmSync(new URL(d, dir), { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

for (const a of artists) {
  if (!a.slug) continue;
  const img = a.card_url || a.photo_url || `${SITE}/images/android-chrome-512x512.png`;
  const abs = /^https?:/.test(img) ? img : `${SITE}/${img.replace(/^\//, "")}`;
  const form = `${SITE}/affair.html?artist=${encodeURIComponent(a.name)}`;
  const title = `Book ${a.name} – Floriqa`;
  const desc = `Booking form for ${a.name}${a.tagline ? ` (${a.tagline.replace(/\s+/g, " ")})` : ""}. It only takes a minute.`;
  mkdirSync(new URL(`${a.slug}/`, dir), { recursive: true });
  writeFileSync(new URL(`${a.slug}/index.html`, dir), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Floriqa" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:image" content="${esc(abs)}" />
  <meta property="og:image:alt" content="${esc(a.name)}" />
  <meta property="og:url" content="${SITE}/book/${esc(a.slug)}/" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:image" content="${esc(abs)}" />
  <link rel="icon" href="../../images/favicon.ico" />
  <script>location.replace(${JSON.stringify(form)});</script>
</head>
<body style="background:#000;color:#fff;font-family:Helvetica,Arial,sans-serif;text-align:center;padding:3rem">
  <p><a style="color:#fff" href="${esc(form)}">Open the booking form for ${esc(a.name)}</a></p>
</body>
</html>
`);
  console.log("book/" + a.slug + "/");
}
