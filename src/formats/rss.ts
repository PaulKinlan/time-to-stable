export function escapeXml(str: unknown): string {
  const s = str === null || str === undefined ? "" : String(str);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeCdata(str: string): string {
  return str.replace(/\]\]>/g, "]]]]><![CDATA[>");
}

export interface RssItem {
  title: string;
  id: string;
  link: string;
  pubDateIso: string;
  htmlContent: string;
}

export function buildRssFeed(opts: {
  title: string;
  description: string;
  link: string;
  selfLink: string;
  updatedIso: string;
  items: readonly RssItem[];
}): Response {
  const pubDate = new Date(opts.updatedIso).toUTCString();
  const itemsXml = opts.items
    .map((item) => {
      const itemPub = new Date(item.pubDateIso).toUTCString();
      return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="false">${escapeXml(item.id)}</guid>
      <pubDate>${escapeXml(itemPub)}</pubDate>
      <description><![CDATA[${escapeCdata(item.htmlContent)}]]></description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(opts.title)}</title>
    <link>${escapeXml(opts.link)}</link>
    <atom:link href="${escapeXml(opts.selfLink)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(opts.description)}</description>
    <lastBuildDate>${escapeXml(pubDate)}</lastBuildDate>
    <generator>Time to Stable</generator>
${itemsXml}
  </channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
    },
  });
}
