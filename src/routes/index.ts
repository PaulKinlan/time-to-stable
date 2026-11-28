import { buildCanonicalUrl, parseQuery } from "../analysis/query.ts";
import { formatDays, formatPct } from "../analysis/support.ts";
import { escapeHtml } from "../formats/html.ts";
import {
  renderBrowserShareChart,
  renderDistributionHistogram,
  renderYearlyCohortChart,
} from "../ui/charts.ts";
import { renderControls } from "../ui/controls.ts";
import { renderPageLayout } from "../ui/layout.ts";
import {
  renderCategoryBreakdownTable,
  renderCrossTabMatrix,
  renderDirectionalComparisonStrip,
  renderKpiGrid,
  renderRawExplorerSection,
  renderSprintersPloddersTables,
  renderYearlyCohortTable,
} from "../ui/tables.ts";
import {
  buildDatasetSchema,
  buildExportOrErrorResponse,
  finishHtml,
  formatBrowserList,
  resolveSummaryAndRows,
  type RouteContext,
} from "./shared.ts";
import type { CategorySlug } from "../types.ts";

export async function handleIndexRoute(
  ctx: RouteContext,
  opts: {
    actionPath?: string;
    slugBrowsers?: readonly string[];
    slugCategories?: readonly CategorySlug[];
    breadcrumbs?: Array<{ label: string; href?: string }>;
  } = {},
): Promise<Response> {
  const validIds = ctx.browsers.map((b) => b.id);
  const query = parseQuery(ctx.request, validIds, {
    slugBrowsers: opts.slugBrowsers,
    slugCategories: opts.slugCategories,
  });

  const actionPath = opts.actionPath ?? ctx.url.pathname;
  const canonicalUrl = buildCanonicalUrl(ctx.origin, actionPath, query);
  const browserList = formatBrowserList(query.browsers, ctx.browsers);
  const title = browserList
    ? `Time to Stable across ${browserList}`
    : "Time to Stable";
  const description = browserList
    ? `Measure how long web features took to reach cross-browser stability across ${browserList} using median, p90, and right-censored Kaplan–Meier survival analysis.`
    : "Measure how long web platform features take to become stable across browsers.";

  if (query.warnings.length > 0 && query.format !== "html") {
    return buildExportOrErrorResponse({
      view: "stable",
      ctx,
      query,
      title,
      description,
      canonicalUrl,
      allRows: [],
      pagedRows: [],
      totalFiltered: 0,
    })!;
  }

  let bodyHtml = "";
  if (query.warnings.length === 0) {
    const { summary, allRows, pagedRows, totalFiltered } =
      await resolveSummaryAndRows(ctx, query, "stable", (ev) => ev.isStable);

    const exported = buildExportOrErrorResponse({
      view: "stable",
      ctx,
      query,
      title,
      description,
      canonicalUrl,
      summary,
      allRows,
      pagedRows,
      totalFiltered,
    });
    if (exported) return exported;

    const kpis = renderKpiGrid([
      {
        label: "Stable Features",
        value: summary.stableCount.toLocaleString("en-US"),
        detail: `${formatPct(summary.completionRate)} of ${summary.totalLanded.toLocaleString("en-US")} landed`,
      },
      {
        label: "Median Time to Stable",
        value: formatDays(summary.distribution.median),
        detail: `IQR: ${formatDays(summary.distribution.iqr)}`,
      },
      {
        label: "p90 Time to Stable",
        value: formatDays(summary.distribution.p90),
        detail: `Mean: ${formatDays(summary.distribution.mean)}`,
      },
      {
        label: "1-Year Convergence (KM)",
        value: formatPct(summary.survival.probStableBy.d365, false),
        detail: `2y KM: ${formatPct(summary.survival.probStableBy.d730, false)}`,
      },
      {
        label: "Fast-Follow (≤30d)",
        value: formatPct(summary.distribution.fastFollowPct, false),
        detail: `${summary.waitingCount.toLocaleString("en-US")} still waiting`,
      },
    ]);

    const spotlight = query.isDefaultSelection
      ? `<div class="callout">
      <strong>Data Stories:</strong> Explore <a href="/stories/is-the-web-getting-faster">Is the Web Getting Faster?</a> (Kaplan–Meier era curves),
      <a href="/stories/the-lumpy-web">The Lumpy Web</a> (single-engine holdouts), or
      <a href="/stories/mobile-parity-gap">The Mobile Parity Gap</a>. <a href="/stories">View all 7 stories →</a>
    </div>`
      : "";

    const crossTabHtml = renderCrossTabMatrix(
      summary.crossTab,
      ctx.browsers,
      `Count of stable features that landed in Browser A first (rows) and Browser B last (columns) across ${browserList}. Click any count to inspect those features below.`,
      "First in",
      "Last in",
      { kind: "first-last", actionPath, query },
    );

    const dirStripHtml = renderDirectionalComparisonStrip(
      summary.crossTab,
      ctx.browsers,
      actionPath,
      query,
    );

    const chartsHtml = `<div class="chart-grid">
      ${renderDistributionHistogram(summary.distribution)}
      ${renderYearlyCohortChart(summary.yearlyCohorts)}
      ${renderBrowserShareChart(summary.browserShare, ctx.browsers)}
    </div>`;

    const categoryHtml = `<h2>Breakdown by Specification Area</h2>
      ${renderCategoryBreakdownTable(summary.byCategory)}`;

    const yearlyHtml = `<h2>Yearly First-Landing Cohorts</h2>
      <div class="callout callout-warn">
        <strong>Statistical Note:</strong> Raw yearly medians suffer from <em>right-censoring</em> in recent years because slower features have not yet finished landing everywhere. Compare the <strong>1y KM%</strong> and <strong>2y KM%</strong> columns for an unbiased pace across cohorts.
        <details class="glossary-details">
          <summary>What do “Cohort Status” and “Right-censored” mean?</summary>
          <ul>
            <li><strong>Cohort</strong>: Every feature that first shipped in <em>any</em> of your selected browsers during that calendar year.</li>
            <li><strong>In progress (right-censored, &lt;80%)</strong>: Fewer than 80% of that year&rsquo;s features have shipped in all selected browsers yet. Because quick features finish within months while harder ones are still waiting in progress, the observed median only reflects the fast finishers and looks artificially low.</li>
            <li><strong>Mature (≥80%)</strong>: At least 80% of the cohort has finished converging across all selected browsers, so its median wait time is stable.</li>
            <li><strong>1y KM% / 2y KM%</strong>: Kaplan–Meier survival estimates that include still-waiting features as censored observations, letting you fairly compare 2025–2026 against older years.</li>
          </ul>
        </details>
      </div>
      ${renderYearlyCohortTable(summary.yearlyCohorts)}`;

    const sprintersHtml = `<h2>The Tortoise and the Hare: Sprinters vs. Plodders</h2>
      <p>Every browser engine sets different priorities, creating <a href="https://paul.kinlan.me/the-lumpy-web/">a lumpy web platform</a>. Below is how often each browser led vs. trailed across stable features.</p>
      ${renderSprintersPloddersTables(summary.browserShare, ctx.browsers, { actionPath, query })}`;

    const explorerHtml = renderRawExplorerSection({
      view: "stable",
      actionPath,
      query,
      rows: pagedRows,
      allFilteredRows: allRows,
      totalFilteredRows: totalFiltered,
      browsers: ctx.browsers,
    });

    bodyHtml = `${spotlight}${kpis}<h2>First-In vs. Last-In Matrix</h2>${crossTabHtml}${dirStripHtml}${chartsHtml}${categoryHtml}${yearlyHtml}${sprintersHtml}${explorerHtml}`;
  }

  const controls = renderControls({
    actionPath,
    browsers: ctx.browsers,
    query,
    canonicalUrl,
  });

  const contentHtml = `<header class="page-intro">
    <h1>${escapeHtml(title)}</h1>
    <p class="page-lead">${escapeHtml(description)}</p>
  </header>
  ${controls}
  ${bodyHtml}`;

  const html = renderPageLayout({
    title,
    description,
    canonicalUrl,
    currentPath: ctx.url.pathname,
    origin: ctx.origin,
    manifest: ctx.manifest,
    dataSource: ctx.dataSource,
    syncStatus: ctx.syncStatus,
    query,
    breadcrumbs: opts.breadcrumbs,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Time to Stable",
        url: ctx.origin,
        description:
          "Web platform compatibility velocity and Baseline analytics built on MDN Browser Compat Data and W3C web-features.",
      },
      ...buildDatasetSchema({
        origin: ctx.origin,
        canonicalUrl,
        name: title,
        description,
        manifest: ctx.manifest,
        breadcrumbs: opts.breadcrumbs,
      }),
    ],
    contentHtml,
  });

  return finishHtml(html);
}
