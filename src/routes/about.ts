import { negotiateFormat } from "../analysis/query.ts";
import { escapeHtml, htmlResponse } from "../formats/html.ts";
import { jsonResponse } from "../formats/json.ts";
import { markdownResponse } from "../formats/markdown.ts";
import { renderPageLayout } from "../ui/layout.ts";
import type { RouteContext } from "./shared.ts";

interface ResourceLink {
  label: string;
  href: string;
  description: string;
  relMe?: boolean;
}

const AUTHOR_LINKS: readonly ResourceLink[] = [
  {
    label: "Personal Site & Blog",
    href: "https://paul.kinlan.me/",
    description: "Essays, engineering notes, and web platform experiments",
    relMe: true,
  },
  {
    label: "AI Focus",
    href: "https://aifoc.us/",
    description: "Writing on AI tooling, agents, and modern web development",
    relMe: true,
  },
  {
    label: "Newsletter",
    href: "https://buttondown.email/paul_kinlan",
    description: "Subscribe to updates on the web platform and AI",
  },
  {
    label: "GitHub (@PaulKinlan)",
    href: "https://github.com/PaulKinlan",
    description: "Open-source projects and source code for Time to Stable",
    relMe: true,
  },
  {
    label: "Bluesky (@paul.kinlan.me)",
    href: "https://bsky.app/profile/paul.kinlan.me",
    description: "Posts on Chrome, web standards, and developer tooling",
    relMe: true,
  },
  {
    label: "Mastodon (@paul@status.kinlan.me)",
    href: "https://status.kinlan.me/@paul",
    description: "Notes on the open web and decentralized protocols",
    relMe: true,
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/paulkinlan",
    description: "Work background in Chrome & Web Developer Relations",
    relMe: true,
  },
];

const ESSAY_LINKS: readonly ResourceLink[] = [
  {
    label: "What is new on the web?",
    href: "https://paul.kinlan.me/what-is-new-on-the-web/",
    description: "Original post introducing the prototype (formerly Now Stable)",
  },
  {
    label: "The Lumpy Web",
    href: "https://paul.kinlan.me/the-lumpy-web/",
    description: "Why uneven browser priorities make cross-browser support feel lumpy",
  },
  {
    label: "Exploring Browser Compat Data with LLMs",
    href: "https://paul.kinlan.me/chatgpt-code-interpreter-and-browser-compat-data/",
    description: "Early empirical slices of MDN BCD convergence and browser wait times",
  },
];

const OPEN_DATA_LINKS: readonly ResourceLink[] = [
  {
    label: "MDN Browser Compat Data (BCD)",
    href: "https://github.com/mdn/browser-compat-data",
    description: "Granular per-API, per-browser support metadata (CC0 1.0)",
  },
  {
    label: "W3C WebDX web-features & Baseline",
    href: "https://github.com/web-platform-dx/web-features",
    description: "Developer-facing web platform features and Baseline status (Apache 2.0)",
  },
  {
    label: "Time to Stable on GitHub",
    href: "https://github.com/PaulKinlan/time-to-stable",
    description: "Source code for the Cloudflare Worker, streaming BCD parser, and statistical engine",
  },
];

function renderAboutMarkdown(opts: {
  canonicalUrl: string;
  origin: string;
  bcdVersion: string;
  bcdTimestamp: string;
  wfVersion: string;
  bcdCount: number;
  wfCount: number;
  dataSource: "r2" | "bundled";
}): string {
  const {
    canonicalUrl,
    origin,
    bcdVersion,
    bcdTimestamp,
    wfVersion,
    bcdCount,
    wfCount,
    dataSource,
  } = opts;

  const linkLines = (items: readonly ResourceLink[]) =>
    items.map((l) => `- [${l.label}](${l.href}) — ${l.description}`).join("\n");

  return `---
title: "About Time to Stable"
canonical: "${canonicalUrl}"
bcd_version: "${bcdVersion}"
web_features_version: "${wfVersion}"
author: "Paul Kinlan"
---

# About Time to Stable

**Time to Stable** ([${origin}](${origin})) measures how long web platform features take to ship across browsers, helping developers answer both *when* an API became safe to adopt and *how long* browser engines actually take to converge.

- **Active Dataset**: MDN BCD \`v${bcdVersion}\` (${bcdTimestamp.slice(0, 10)}, ${bcdCount.toLocaleString("en-US")} compat keys) & W3C WebDX \`web-features\` \`v${wfVersion}\` (${wfCount.toLocaleString("en-US")} features) · Source: \`${dataSource}\`

## Why Time to Stable Exists

Time to Stable began as an experiment ("Now Stable") described in [What is new on the web?](https://paul.kinlan.me/what-is-new-on-the-web/): instead of guessing whether modern web capabilities have landed across your target browsers, query empirical release dates directly. It pairs with [The Lumpy Web](https://paul.kinlan.me/the-lumpy-web/) to show which features are waiting on a single browser engine, and which direction lag flows between pairs of engines (for instance, first in Safari -> last in Chrome vs. first in Chrome -> last in Safari).

## Data & Statistical Approach

- **Dual Granularity**: Switch between granular MDN BCD spec keys (${bcdCount.toLocaleString("en-US")} keys) and developer-facing W3C WebDX \`web-features\` / Baseline definitions (${wfCount.toLocaleString("en-US")} features).
- **Right-Skew & Quantiles**: Time-to-stable distributions have a long multi-year tail, so Time to Stable pairs **median**, **IQR (p25–p75)**, **p90**, and **fast-follow (<=30d)** with the arithmetic mean.
- **Right-Censoring & Kaplan–Meier Survival**: Recent yearly cohorts (<80% complete) are flagged as **In progress (right-censored)** rather than letting fast finishers bias recent wait times downward; **1y / 2y KM%** probabilities incorporate still-waiting features honestly.
- **Bidirectional Pairwise Comparisons**: Click any cell in the First-In vs. Last-In matrix or swap directions in the Feature Explorer to isolate every feature that shipped in Browser A first and Browser B last.

## Architecture (Humans & Agents)

- **100% Cloudflare-Native**: Runs on Cloudflare Workers, Static Assets, and R2 with zero runtime npm dependencies.
- **Self-Updating Data Pipeline**: A Cloudflare Cron Trigger (\`0 */6 * * *\`) checks npm for new \`@mdn/browser-compat-data\` and \`web-features\` releases, stream-parses \`data.json\` inside the 128 MB isolate limit, writes category shards and precomputed stories directly into R2, and snapshots platform history.
- **Agent-Ready**: Supports \`Accept: text/markdown\` / \`?type=md\`, \`?type=json\`, \`?type=csv\`, \`?type=rss\`, [${origin}/llms.txt](${origin}/llms.txt), [${origin}/llms-full.txt](${origin}/llms-full.txt), [${origin}/openapi.json](${origin}/openapi.json), and progressive WebMCP (\`navigator.modelContext\`).

## About Paul Kinlan

**Paul Kinlan** leads Developer Relations for Google Chrome and the Open Web, writing and building around web standards, browser capabilities, AI-assisted development, and open web architecture.

${linkLines(AUTHOR_LINKS)}

### Background Essays

${linkLines(ESSAY_LINKS)}

## Open Data & Source Code

${linkLines(OPEN_DATA_LINKS)}
`;
}

function renderLinkCards(items: readonly ResourceLink[]): string {
  return `<div class="author-links">
  ${items
    .map(
      (item) => `<a class="dir-card" href="${escapeHtml(item.href)}" target="_blank" rel="${item.relMe ? "me noopener" : "noopener"}">
    <div class="dir-card-title">${escapeHtml(item.label)}</div>
    <div class="dir-card-meta">${escapeHtml(item.description)}</div>
    <div class="dir-card-cta">${escapeHtml(item.href.replace(/^https:\/\//, ""))} ↗</div>
  </a>`,
    )
    .join("")}
</div>`;
}

export function handleAboutRoute(ctx: RouteContext): Response {
  const { manifest, origin, dataSource, syncStatus } = ctx;
  const canonicalUrl = `${origin}/about`;
  const title = "About Time to Stable";
  const description =
    "Why Time to Stable exists, how it measures cross-browser web platform convergence, and who built it — Paul Kinlan.";
  const bcdCount = Object.values(manifest.counts).reduce((a, b) => a + b, 0);
  const wfCount = manifest.webFeatureCount;
  const format = negotiateFormat(ctx.request);

  if (format === "json") {
    return jsonResponse({
      meta: {
        title,
        description,
        canonicalUrl,
        bcdVersion: manifest.bcdVersion,
        bcdTimestamp: manifest.bcdTimestamp,
        webFeaturesVersion: manifest.webFeaturesVersion,
        bcdCount,
        webFeatureCount: wfCount,
        dataSource,
      },
      project: {
        name: "Time to Stable",
        url: origin,
        methodology: [
          "Dual granularity across MDN BCD keys and W3C WebDX web-features / Baseline definitions.",
          "Skew-aware quantiles (median, IQR, p90, fast-follow <=30d) alongside mean.",
          "Kaplan-Meier survival estimates and <80% right-censoring detection for recent yearly cohorts.",
          "Bidirectional pairwise drill-down (First in Browser A -> Last in Browser B).",
        ],
        architecture:
          "TypeScript Cloudflare Worker + Static Assets + R2 + 6-hour Cron Trigger with streaming BCD ingestion.",
      },
      author: {
        name: "Paul Kinlan",
        role: "Lead, Chrome & Web Developer Relations at Google",
        links: AUTHOR_LINKS.map(({ label, href, description: d }) => ({
          label,
          href,
          description: d,
        })),
        essays: ESSAY_LINKS.map(({ label, href, description: d }) => ({
          label,
          href,
          description: d,
        })),
      },
      credits: OPEN_DATA_LINKS.map(({ label, href, description: d }) => ({
        label,
        href,
        description: d,
      })),
    });
  }

  if (format === "md") {
    return markdownResponse(
      renderAboutMarkdown({
        canonicalUrl,
        origin,
        bcdVersion: manifest.bcdVersion,
        bcdTimestamp: manifest.bcdTimestamp,
        wfVersion: manifest.webFeaturesVersion,
        bcdCount,
        wfCount,
        dataSource,
      }),
    );
  }

  const contentHtml = `<header class="page-intro">
    <h1>About Time to Stable</h1>
    <p class="page-lead">${escapeHtml(description)}</p>
    <div class="export-links">
      <a class="btn btn-primary" href="/">Explore Comparisons</a>
      <a class="btn" href="/stories">Read the 7 Data Stories</a>
      <a class="btn" href="/about?type=md">Markdown</a>
      <a class="btn" href="/about?type=json">JSON</a>
    </div>
  </header>

  <section class="about-prose" aria-labelledby="why-heading">
    <h2 id="why-heading">Why Time to Stable Exists</h2>
    <p>
      Web developers constantly ask two practical questions about new browser capabilities:
      <strong>&ldquo;Can I use this across my target browsers yet?&rdquo;</strong> and
      <strong>&ldquo;How long does it actually take for a feature shipped by one engine to land everywhere else?&rdquo;</strong>
    </p>
    <p>
      Time to Stable started as a prototype called <em>Now Stable</em> described in
      <a href="https://paul.kinlan.me/what-is-new-on-the-web/" target="_blank" rel="noopener">What is new on the web?</a>.
      Rather than relying on intuition, it turns every release date in MDN Browser Compat Data and W3C WebDX Baseline into empirical timelines — showing not only when APIs became safe to rely on, but also where
      <a href="https://paul.kinlan.me/the-lumpy-web/" target="_blank" rel="noopener">the web remains lumpy</a>
      and how lag flows in both directions between pairs of browsers.
    </p>
  </section>

  <section class="about-prose" aria-labelledby="methodology-heading">
    <h2 id="methodology-heading">Data &amp; Statistical Approach</h2>
    <ul class="about-list">
      <li>
        <strong>Two Lenses on the Platform:</strong> Toggle between granular <strong>MDN BCD keys</strong>
        (currently ${bcdCount.toLocaleString("en-US")} API, CSS, HTML, HTTP, JavaScript, and WebAssembly keys in <code>v${escapeHtml(manifest.bcdVersion)}</code>)
        and developer-facing <strong>W3C WebDX web-features</strong>
        (${wfCount.toLocaleString("en-US")} capabilities with Baseline Widely / Newly / Limited classifications in <code>v${escapeHtml(manifest.webFeaturesVersion)}</code>).
      </li>
      <li>
        <strong>Built for Extreme Right-Skew:</strong> Most features stabilize relatively quickly while a long tail takes years. Every comparison reports <strong>median</strong>, <strong>IQR (p25–p75)</strong>, <strong>p90</strong>, and <strong>fast-follow (≤30d)</strong> alongside the mean.
      </li>
      <li>
        <strong>Right-Censoring &amp; Kaplan–Meier Survival:</strong> Yearly cohorts with fewer than 80% converged features are marked <strong>In progress (right-censored)</strong> so fast finishers do not make recent years look misleadingly fast; <strong>1y KM%</strong> and <strong>2y KM%</strong> include features still waiting to converge.
      </li>
      <li>
        <strong>Bidirectional Lag Exploration:</strong> Click any cell in the First-In vs. Last-In matrix or swap directions inside the Feature Explorer to inspect every feature that shipped in Browser A first and Browser B last.
      </li>
    </ul>
  </section>

  <section class="about-prose" aria-labelledby="architecture-heading">
    <h2 id="architecture-heading">How It Runs (For Humans &amp; Agents)</h2>
    <p>
      Time to Stable runs directly on the <strong>Cloudflare Workers</strong> edge with Static Assets, <strong>R2 Object Storage</strong>, and a <strong>6-hour Cron Trigger</strong> — with zero runtime npm dependencies. When npm publishes a new <code>@mdn/browser-compat-data</code> or <code>web-features</code> release, the Worker stream-parses the dataset inside a 128 MB isolate, compiles category shards and precomputed stories into R2, and appends a historical platform snapshot automatically.
    </p>
    <div class="callout">
      <strong>Agentic &amp; Machine-Readable Interfaces:</strong> Every page supports
      <code>Accept: text/markdown</code> (or <code>?type=md</code>) and <code>?type=json</code> alongside
      <a href="/llms.txt">/llms.txt</a>, <a href="/llms-full.txt">/llms-full.txt</a>,
      <a href="/openapi.json">/openapi.json</a>, RFC-4180 CSV exports, RSS feeds, and progressive WebMCP tools.
    </div>
  </section>

  <section aria-labelledby="author-heading">
    <h2 id="author-heading">About Paul Kinlan</h2>
    <p class="about-prose">
      Time to Stable was created by <strong>Paul Kinlan</strong>, who leads Developer Relations for Google Chrome and the Open Web. He writes regularly about web platform capabilities, open standards, AI tooling, and developer ecosystems.
    </p>
    ${renderLinkCards(AUTHOR_LINKS)}
    <h3>Background Writing</h3>
    ${renderLinkCards(ESSAY_LINKS)}
  </section>

  <section aria-labelledby="credits-heading">
    <h2 id="credits-heading">Open Data &amp; Source Code</h2>
    <p class="about-prose">
      None of this analysis would exist without the open-web maintainers behind Browser Compat Data and WebDX Baseline.
    </p>
    ${renderLinkCards(OPEN_DATA_LINKS)}
  </section>`;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "AboutPage",
      name: title,
      url: canonicalUrl,
      description,
      mainEntity: {
        "@type": "Person",
        name: "Paul Kinlan",
        url: "https://paul.kinlan.me/",
        jobTitle: "Lead, Chrome & Web Developer Relations at Google",
        sameAs: AUTHOR_LINKS.map((l) => l.href),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: origin },
        { "@type": "ListItem", position: 2, name: "About", item: canonicalUrl },
      ],
    },
  ];

  const html = renderPageLayout({
    title,
    description,
    canonicalUrl,
    currentPath: "/about",
    origin,
    manifest,
    dataSource,
    syncStatus,
    markdownUrl: `${canonicalUrl}?type=md`,
    jsonUrl: `${canonicalUrl}?type=json`,
    breadcrumbs: [{ label: "Home", href: "/" }, { label: "About" }],
    jsonLd,
    contentHtml,
  });

  return htmlResponse(html);
}
