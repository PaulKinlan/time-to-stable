import { CompatData, BrowserName, ValidFeatures } from "../types.d.ts";

// Main pages available in the application
const PAGES = [
  { path: "/", name: "Time to Stable", description: "APIs stable across browsers" },
  { path: "/not-stable", name: "Not Yet Stable", description: "APIs not yet stable" },
  { path: "/when-stable", name: "Now Stable", description: "When APIs became stable" },
  { path: "/experimental", name: "Experimental APIs", description: "Experimental APIs" },
  { path: "/deprecated", name: "Deprecated APIs", description: "Deprecated APIs" },
  { path: "/removed", name: "Removed APIs", description: "APIs removed from the web" },
  { path: "/all", name: "All APIs", description: "All APIs for export" },
];

// Common browser combinations for sitemap - popular combinations users would search for
const BROWSER_COMBINATIONS: BrowserName[][] = [
  ["chrome", "firefox"],
  ["chrome", "safari"],
  ["chrome", "edge"],
  ["firefox", "safari"],
  ["firefox", "edge"],
  ["safari", "edge"],
  ["chrome", "firefox", "safari"],
  ["chrome", "firefox", "edge"],
  ["chrome", "safari", "edge"],
  ["firefox", "safari", "edge"],
  ["chrome", "firefox", "safari", "edge"],
  ["chrome", "chrome_android"],
  ["safari", "safari_ios"],
  ["chrome", "firefox", "safari", "edge", "chrome_android", "safari_ios"],
];

// Feature combinations - covering all valid features
const FEATURE_COMBINATIONS: ValidFeatures[][] = [
  ["api"],
  ["css"],
  ["html"],
  ["javascript"],
  ["http"],
  ["webassembly"],
  ["api", "css"],
  ["api", "html"],
  ["api", "javascript"],
  ["css", "html"],
  ["api", "css", "html"],
  ["api", "css", "html", "javascript"],
  ["api", "css", "html", "javascript", "http", "webassembly"],
];

function generateQueryString(browsers: BrowserName[], features: ValidFeatures[]): string {
  const browserParams = browsers.map(b => `browser-${b}=on`).join("&");
  const featureParams = features.map(f => `feature-${f}=on`).join("&");
  return [browserParams, featureParams].filter(Boolean).join("&");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default function render(request: Request, _bcd: CompatData): Response {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  
  const today = new Date().toISOString().split('T')[0];
  
  const urls: string[] = [];

  // Add base pages without query parameters
  for (const page of PAGES) {
    urls.push(`  <url>
    <loc>${escapeXml(baseUrl + page.path)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`);
  }

  // Add pages with browser and feature combinations
  for (const page of PAGES) {
    for (const browsers of BROWSER_COMBINATIONS) {
      for (const features of FEATURE_COMBINATIONS) {
        const queryString = generateQueryString(browsers, features);
        const fullUrl = `${baseUrl}${page.path}?${queryString}`;
        
        urls.push(`  <url>
    <loc>${escapeXml(fullUrl)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`);
      }
    }
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  return new Response(sitemap, {
    status: 200,
    headers: { 
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600"
    },
  });
}
