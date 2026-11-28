import { buildSelectionParams } from "../analysis/query.ts";
import { escapeHtml } from "../formats/html.ts";
import type { Manifest, ParsedQuery, SyncStatus } from "../types.ts";

export interface NavItem {
  path: string;
  label: string;
  preserveSelection: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { path: "/", label: "Time to Stable", preserveSelection: true },
  { path: "/not-stable", label: "Not Yet Stable", preserveSelection: true },
  { path: "/when-stable", label: "Now Stable", preserveSelection: true },
  { path: "/baseline", label: "Baseline", preserveSelection: false },
  { path: "/stories", label: "Stories", preserveSelection: false },
  { path: "/experimental", label: "Experimental", preserveSelection: true },
  { path: "/deprecated", label: "Deprecated", preserveSelection: true },
  { path: "/removed", label: "Removed", preserveSelection: true },
  { path: "/all", label: "All APIs", preserveSelection: true },
  { path: "/about", label: "About", preserveSelection: false },
];

export interface PageLayoutOptions {
  title: string;
  description: string;
  canonicalUrl: string;
  currentPath: string;
  origin: string;
  manifest: Manifest;
  dataSource: "r2" | "bundled";
  syncStatus?: SyncStatus | null;
  query?: ParsedQuery;
  rssUrl?: string;
  markdownUrl?: string;
  jsonUrl?: string;
  jsonLd?: unknown;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  contentHtml: string;
}

function buildNavHref(item: NavItem, query?: ParsedQuery): string {
  if (!item.preserveSelection || !query || query.isDefaultSelection) {
    return item.path;
  }
  const qs = buildSelectionParams(query);
  return qs ? `${item.path}?${qs}` : item.path;
}

function renderBreadcrumbs(
  breadcrumbs?: Array<{ label: string; href?: string }>,
): string {
  if (!breadcrumbs || breadcrumbs.length === 0) return "";
  const items = breadcrumbs
    .map((b) =>
      b.href
        ? `<li><a href="${escapeHtml(b.href)}">${escapeHtml(b.label)}</a></li>`
        : `<li aria-current="page">${escapeHtml(b.label)}</li>`,
    )
    .join("");
  return `<nav aria-label="Breadcrumb"><ol class="breadcrumbs">${items}</ol></nav>`;
}

export function renderPageLayout(opts: PageLayoutOptions): string {
  const {
    title,
    description,
    canonicalUrl,
    currentPath,
    origin,
    manifest,
    dataSource,
    syncStatus,
    query,
    rssUrl,
    markdownUrl,
    jsonUrl,
    jsonLd,
    breadcrumbs,
    contentHtml,
  } = opts;

  const fullTitle = title.includes("Time to Stable")
    ? title
    : `${title} — Time to Stable`;

  const navLinks = NAV_ITEMS.map((item) => {
    const isCurrent =
      item.path === "/"
        ? currentPath === "/" || currentPath.startsWith("/compare/")
        : currentPath === item.path || currentPath.startsWith(`${item.path}/`);
    const href = buildNavHref(item, query);
    return `<li><a href="${escapeHtml(href)}"${isCurrent ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a></li>`;
  }).join("");

  const altMarkdown =
    markdownUrl ??
    (canonicalUrl.includes("?")
      ? `${canonicalUrl}&type=md`
      : `${canonicalUrl}?type=md`);
  const altJson =
    jsonUrl ??
    (canonicalUrl.includes("?")
      ? `${canonicalUrl}&type=json`
      : `${canonicalUrl}?type=json`);

  const jsonLdScript = jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`
    : "";

  const bcdDate = manifest.bcdTimestamp.slice(0, 10);
  const sourceBadge = dataSource === "r2" ? "R2 Live" : "Bundled Snapshot";
  const lastChecked = syncStatus?.checkedAt
    ? ` · Last update check ${escapeHtml(syncStatus.checkedAt.slice(0, 16).replace("T", " "))} UTC`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <script>
  {
    try {
      const saved = localStorage.getItem("color-scheme");
      if (saved === "light" || saved === "dark") {
        document.querySelector('meta[name="color-scheme"]').content = saved;
        document.documentElement.classList.add("theme-" + saved);
      }
    } catch {}
  }
  </script>
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="author" content="Paul Kinlan">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <link rel="alternate" type="text/markdown" href="${escapeHtml(altMarkdown)}" title="Markdown representation">
  <link rel="alternate" type="application/json" href="${escapeHtml(altJson)}" title="JSON representation">
  ${rssUrl ? `<link rel="alternate" type="application/rss+xml" href="${escapeHtml(rssUrl)}" title="RSS feed">` : ""}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(fullTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${escapeHtml(fullTitle)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <link rel="icon" type="image/png" href="/images/favicon.png">
  <link rel="author" href="https://paul.kinlan.me/">
  <link rel="stylesheet" href="/styles/app.css">
  ${jsonLdScript}
</head>
<body>
  <header class="site-header">
    <div class="container">
      <div class="header-bar">
        <a class="brand" href="/">
          <span class="brand-title">Time to Stable</span>
          <span class="brand-meta">BCD v${escapeHtml(manifest.bcdVersion)} · WF v${escapeHtml(manifest.webFeaturesVersion)}</span>
        </a>
        <div class="header-actions">
          <a href="/llms.txt">For Agents</a>
          <button type="button" id="theme-toggle" class="theme-toggle" aria-label="Toggle color theme">Theme: System</button>
        </div>
      </div>
      <nav class="primary-nav" aria-label="Primary">
        <ul>${navLinks}</ul>
      </nav>
    </div>
  </header>
  <main class="container">
    ${renderBreadcrumbs(breadcrumbs)}
    ${contentHtml}
  </main>
  <footer class="site-footer">
    <div class="container footer-grid">
      <div>
        <p>
          Created by <a href="https://paul.kinlan.me">Paul Kinlan</a>.
          Data: <a href="https://github.com/mdn/browser-compat-data">MDN BCD</a> v${escapeHtml(manifest.bcdVersion)} (${escapeHtml(bcdDate)}) &amp;
          <a href="https://github.com/web-platform-dx/web-features">web-features</a> v${escapeHtml(manifest.webFeaturesVersion)}
          · <span class="badge badge-limited">${escapeHtml(sourceBadge)}</span>${lastChecked}
        </p>
        <p>
          Read the <a href="https://paul.kinlan.me/what-is-new-on-the-web/">introductory article</a> or view the <a href="https://github.com/PaulKinlan/time-to-stable">source repository</a>.
        </p>
      </div>
      <div class="footer-links">
        <a href="/stories">Data Stories</a>
        <a href="/baseline">Baseline Explorer</a>
        <a href="/about">About</a>
        <a href="/llms.txt">llms.txt</a>
        <a href="/llms-full.txt">llms-full.txt</a>
        <a href="/openapi.json">OpenAPI 3.1</a>
        <a href="/sitemap.xml">Sitemap</a>
      </div>
    </div>
  </footer>
  <div id="svg-tooltip" class="svg-tooltip" role="status" aria-hidden="true"></div>
  <script type="module" src="/scripts/app.js"></script>
</body>
</html>`;
}
