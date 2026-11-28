import { BROWSER_PRESETS, CATEGORIES } from "../analysis/query.ts";
import { cleanIsoDate } from "../analysis/support.ts";
import { escapeXml } from "../formats/rss.ts";
import type { RouteContext } from "./shared.ts";

export function handleRobotsTxt(ctx: RouteContext): Response {
  const body = `User-agent: *
Allow: /
Allow: /compare/
Allow: /stories/
Allow: /feature/
Allow: /baseline
Allow: /not-stable
Allow: /when-stable
Allow: /about
Allow: /llms.txt
Allow: /llms-full.txt
Allow: /openapi.json
Allow: /sitemaps/
Disallow: /api/admin/
Disallow: /*?*page=
Disallow: /*?*q=
Disallow: /*?*sort=
Disallow: /*?*first=
Disallow: /*?*last=
Disallow: /*?*has=
Disallow: /*?*missing=

Sitemap: ${ctx.origin}/sitemap.xml
`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

export function handleSitemapIndex(ctx: RouteContext): Response {
  const lastmod = ctx.manifest.bcdTimestamp.slice(0, 10);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${escapeXml(`${ctx.origin}/sitemaps/core.xml`)}</loc>
    <lastmod>${escapeXml(lastmod)}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${escapeXml(`${ctx.origin}/sitemaps/features.xml`)}</loc>
    <lastmod>${escapeXml(lastmod)}</lastmod>
  </sitemap>
</sitemapindex>`;

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
    },
  });
}

export async function handleCoreSitemap(ctx: RouteContext): Promise<Response> {
  const pre = await ctx.store.getPrecomputed();
  const lastmod = ctx.manifest.bcdTimestamp.slice(0, 10);

  const entries: Array<{ loc: string; changefreq: string; priority: string }> = [
    { loc: `${ctx.origin}/`, changefreq: "daily", priority: "1.0" },
    { loc: `${ctx.origin}/stories`, changefreq: "daily", priority: "0.95" },
    { loc: `${ctx.origin}/baseline`, changefreq: "daily", priority: "0.95" },
    { loc: `${ctx.origin}/not-stable`, changefreq: "daily", priority: "0.9" },
    { loc: `${ctx.origin}/when-stable`, changefreq: "daily", priority: "0.9" },
    { loc: `${ctx.origin}/experimental`, changefreq: "weekly", priority: "0.7" },
    { loc: `${ctx.origin}/deprecated`, changefreq: "weekly", priority: "0.7" },
    { loc: `${ctx.origin}/removed`, changefreq: "weekly", priority: "0.7" },
    { loc: `${ctx.origin}/all`, changefreq: "weekly", priority: "0.6" },
    { loc: `${ctx.origin}/about`, changefreq: "monthly", priority: "0.75" },
    { loc: `${ctx.origin}/llms.txt`, changefreq: "daily", priority: "0.8" },
  ];

  for (const story of pre.stories) {
    entries.push({
      loc: `${ctx.origin}/stories/${story.slug}`,
      changefreq: "daily",
      priority: "0.9",
    });
  }

  for (const preset of BROWSER_PRESETS) {
    entries.push({
      loc: `${ctx.origin}/compare/${preset.slug}`,
      changefreq: "daily",
      priority: "0.85",
    });
    for (const cat of CATEGORIES) {
      entries.push({
        loc: `${ctx.origin}/compare/${preset.slug}/${cat}`,
        changefreq: "weekly",
        priority: "0.75",
      });
    }
    entries.push({
      loc: `${ctx.origin}/compare/${preset.slug}/not-stable`,
      changefreq: "daily",
      priority: "0.8",
    });
    entries.push({
      loc: `${ctx.origin}/compare/${preset.slug}/when-stable`,
      changefreq: "daily",
      priority: "0.8",
    });
  }

  const urlsXml = entries
    .map(
      (e) => `  <url>
    <loc>${escapeXml(e.loc)}</loc>
    <lastmod>${escapeXml(lastmod)}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlsXml}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
    },
  });
}

export async function handleFeaturesSitemap(
  ctx: RouteContext,
): Promise<Response> {
  const webFeatures = await ctx.store.getWebFeatures();
  const lastmod = ctx.manifest.bcdTimestamp.slice(0, 10);

  const urlsXml = webFeatures
    .map((wf) => {
      const featureMod = wf.baselineLowDate
        ? cleanIsoDate(wf.baselineLowDate)
        : lastmod;
      return `  <url>
    <loc>${escapeXml(`${ctx.origin}/feature/${encodeURIComponent(wf.id)}`)}</loc>
    <lastmod>${escapeXml(featureMod)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlsXml}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
    },
  });
}
