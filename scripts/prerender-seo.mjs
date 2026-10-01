// Post-build SEO step (runs after `vite build`).
//
// wen.tools is a single-page app, so every URL used to serve the same raw
// HTML: one title, one description, one H1, no canonical. Search engines saw
// ~50 identical pages and fell back to titling them all "wen.tools".
//
// For each route in src/seo/routes.json this writes dist/<route>.html with
// its own <title>, description, canonical, social tags and crawlable H1.
// With `cleanUrls` in vercel.json, /airdrop is served from dist/airdrop.html
// before the SPA catch-all rewrite applies. It also generates sitemap.xml
// from the same table, so the sitemap can never drift from the routes.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SITE = "https://www.wen.tools";
const DIST = "dist";

const routes = JSON.parse(readFileSync("src/seo/routes.json", "utf8"));
const template = readFileSync(join(DIST, "index.html"), "utf8");

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const url = (path) => (path === "/" ? `${SITE}/` : `${SITE}${path}`);

function setAttr(html, pattern, value) {
  if (!pattern.test(html)) throw new Error(`SEO prerender: pattern not found: ${pattern}`);
  return html.replace(pattern, (_, pre, post) => `${pre}${esc(value)}${post}`);
}

function render(path, seo) {
  // Alias routes inherit their canonical target's copy
  const target = seo.canonical ? routes[seo.canonical] : seo;
  if (!target?.title) throw new Error(`SEO prerender: no title for ${path}`);
  const canonical = url(seo.canonical ?? path);
  const heading = target.title.replace(/\s*\|\s*wen\.tools$/, "");

  let html = template;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(target.title)}</title>`);
  html = setAttr(html, /(<link rel="canonical" href=")[^"]*(")/, canonical);
  html = setAttr(html, /(<meta\s+name="description"\s+content=")[^"]*(")/, target.description);
  html = setAttr(html, /(property="og:url" content=")[^"]*(")/, canonical);
  html = setAttr(html, /(property="og:title" content=")[^"]*(")/, target.title);
  html = setAttr(html, /(property="og:description" content=")[^"]*(")/, target.description);
  html = setAttr(html, /(name="twitter:url" content=")[^"]*(")/, canonical);
  html = setAttr(html, /(name="twitter:title" content=")[^"]*(")/, target.title);
  html = setAttr(html, /(name="twitter:description" content=")[^"]*(")/, target.description);
  // Route-specific crawlable heading and summary in the pre-hydration block
  html = html.replace(
    /(<main style="position: absolute[^>]*>\s*)<h1>[^<]*<\/h1>(\s*<p data-seo>[^<]*<\/p>)?/,
    `$1<h1>${esc(heading)}</h1>\n        <p data-seo>${esc(target.description)}</p>`
  );
  return html;
}

let pages = 0;
for (const [path, seo] of Object.entries(routes)) {
  const html = render(path, seo);
  const file = path === "/" ? join(DIST, "index.html") : join(DIST, `${path.slice(1)}.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  pages++;
}

const today = new Date().toISOString().slice(0, 10);
const entries = Object.entries(routes)
  .filter(([, seo]) => seo.title && !seo.canonical)
  .map(
    ([path]) =>
      `  <url>\n    <loc>${url(path)}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${
        path === "/" ? "1.0" : "0.8"
      }</priority>\n  </url>`
  );
writeFileSync(
  join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`
);

console.log(`SEO prerender: ${pages} route pages, ${entries.length} sitemap URLs`);
