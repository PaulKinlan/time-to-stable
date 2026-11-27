import { negotiateFormat } from "../analysis/query.ts";
import { escapeHtml } from "../formats/html.ts";
import { jsonResponse } from "../formats/json.ts";
import { markdownResponse, storyToMarkdown } from "../formats/markdown.ts";
import {
  renderGenericBarsChart,
  renderSurvivalCurvesChart,
} from "../ui/charts.ts";
import { renderPageLayout } from "../ui/layout.ts";
import { renderKpiGrid } from "../ui/tables.ts";
import { finishHtml, type RouteContext } from "./shared.ts";

export async function handleStoriesRoute(
  ctx: RouteContext,
  slug?: string,
): Promise<Response | null> {
  const format = negotiateFormat(ctx.request);
  const pre = await ctx.store.getPrecomputed();

  if (!slug) {
    const canonicalUrl = `${ctx.origin}/stories`;
    const title = "Web Platform Data Stories";
    const description =
      "Seven empirical stories computed from MDN Browser Compat Data and W3C web-features: convergence speed, Interop impact, single-engine bottlenecks, and mobile parity.";

    if (format === "json") {
      return jsonResponse({
        meta: {
          title,
          canonicalUrl,
          bcdVersion: ctx.manifest.bcdVersion,
          webFeaturesVersion: ctx.manifest.webFeaturesVersion,
        },
        stories: pre.stories.map((s) => ({
          slug: s.slug,
          title: s.title,
          subtitle: s.subtitle,
          categoryTag: s.categoryTag,
          metrics: s.metrics,
          keyTakeaways: s.keyTakeaways,
          url: `${ctx.origin}/stories/${s.slug}`,
        })),
      });
    }

    if (format === "md") {
      const md = [
        `# ${title}`,
        "",
        description,
        "",
        ...pre.stories.flatMap((s) => [
          `## [${s.title}](/stories/${s.slug})`,
          "",
          `*${s.subtitle}*`,
          "",
          ...s.keyTakeaways.map((t) => `- ${t}`),
          "",
        ]),
      ].join("\n");
      return markdownResponse(md);
    }

    const cards = pre.stories
      .map(
        (s) => `<article class="story-card">
      <div>
        <div class="story-tag">${escapeHtml(s.categoryTag)}</div>
        <h3><a href="/stories/${escapeHtml(s.slug)}">${escapeHtml(s.title)}</a></h3>
        <p>${escapeHtml(s.subtitle)}</p>
      </div>
      <div>
        <p><strong>${escapeHtml(s.metrics[0]?.label ?? "")}:</strong> ${escapeHtml(s.metrics[0]?.value ?? "")}</p>
        <div class="export-links">
          <a class="btn" href="/stories/${escapeHtml(s.slug)}">Read Story</a>
          <a class="btn" href="/stories/${escapeHtml(s.slug)}?type=md">MD</a>
          <a class="btn" href="/stories/${escapeHtml(s.slug)}?type=json">JSON</a>
        </div>
      </div>
    </article>`,
      )
      .join("");

    const html = renderPageLayout({
      title,
      description,
      canonicalUrl,
      currentPath: "/stories",
      origin: ctx.origin,
      manifest: ctx.manifest,
      dataSource: ctx.dataSource,
      syncStatus: ctx.syncStatus,
      breadcrumbs: [{ label: "Home", href: "/" }, { label: "Stories" }],
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: title,
        description,
        url: canonicalUrl,
      },
      contentHtml: `<header class="page-intro">
        <h1>${escapeHtml(title)}</h1>
        <p class="page-lead">${escapeHtml(description)}</p>
      </header>
      <div class="story-grid">${cards}</div>`,
    });
    return finishHtml(html);
  }

  const story = pre.stories.find((s) => s.slug === slug);
  if (!story) return null;

  const canonicalUrl = `${ctx.origin}/stories/${story.slug}`;
  if (format === "json") {
    return jsonResponse({
      meta: {
        canonicalUrl,
        bcdVersion: ctx.manifest.bcdVersion,
        webFeaturesVersion: ctx.manifest.webFeaturesVersion,
      },
      story,
    });
  }

  if (format === "md") {
    return markdownResponse(storyToMarkdown(story, canonicalUrl, ctx.manifest));
  }

  const charts: string[] = [];
  if (story.survivalCurves && story.survivalCurves.length > 0) {
    charts.push(
      renderSurvivalCurvesChart(
        story.survivalCurves,
        "Kaplan–Meier Survival Curve Across Eras",
        "Cumulative probability of a landed Web Feature achieving support in Chrome, Firefox, and Safari over 5 years.",
      ),
    );
  }
  if (story.bars) {
    charts.push(renderGenericBarsChart(story.bars));
  }

  const tablesHtml = story.tables
    .map(
      (t) => `<h2>${escapeHtml(t.title)}</h2>
    <div class="table-wrap"><table class="data-table">
      <thead><tr>${t.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>
      <tbody>${
        t.rows.length
          ? t.rows
              .map(
                (r) =>
                  `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`,
              )
              .join("")
          : `<tr><td colspan="${t.columns.length}">No matching entries in the current release.</td></tr>`
      }</tbody>
    </table></div>`,
    )
    .join("");

  const html = renderPageLayout({
    title: story.title,
    description: story.subtitle,
    canonicalUrl,
    currentPath: `/stories/${story.slug}`,
    origin: ctx.origin,
    manifest: ctx.manifest,
    dataSource: ctx.dataSource,
    syncStatus: ctx.syncStatus,
    breadcrumbs: [
      { label: "Home", href: "/" },
      { label: "Stories", href: "/stories" },
      { label: story.title },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: story.title,
        description: story.subtitle,
        url: canonicalUrl,
        dateModified: ctx.manifest.bcdTimestamp,
        author: {
          "@type": "Person",
          name: "Paul Kinlan",
          url: "https://paul.kinlan.me/",
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: ctx.origin },
          {
            "@type": "ListItem",
            position: 2,
            name: "Stories",
            item: `${ctx.origin}/stories`,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: story.title,
            item: canonicalUrl,
          },
        ],
      },
    ],
    contentHtml: `<header class="page-intro">
      <div class="story-tag">${escapeHtml(story.categoryTag)}</div>
      <h1>${escapeHtml(story.title)}</h1>
      <p class="page-lead">${escapeHtml(story.subtitle)}</p>
      <div class="export-links">
        <a class="btn" href="/stories/${escapeHtml(story.slug)}?type=md">Markdown</a>
        <a class="btn" href="/stories/${escapeHtml(story.slug)}?type=json">JSON</a>
        <a class="btn" href="/stories">All Stories</a>
      </div>
    </header>
    <p>${escapeHtml(story.summary)}</p>
    ${renderKpiGrid(story.metrics)}
    <section class="takeaways" aria-label="Key Takeaways">
      <h2>Key Takeaways</h2>
      <ul>${story.keyTakeaways.map((k) => `<li>${escapeHtml(k)}</li>`).join("")}</ul>
    </section>
    <div class="callout"><strong>Methodology:</strong> ${escapeHtml(story.methodology)}</div>
    ${charts.length ? `<div class="chart-grid">${charts.join("")}</div>` : ""}
    ${tablesHtml}`,
  });

  return finishHtml(html);
}
