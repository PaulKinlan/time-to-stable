import { buildCanonicalUrl, parseQuery } from "../analysis/query.ts";
import { computeDistribution } from "../analysis/stats.ts";
import { formatDays } from "../analysis/support.ts";
import { escapeHtml } from "../formats/html.ts";
import { renderGenericBarsChart } from "../ui/charts.ts";
import { renderControls } from "../ui/controls.ts";
import { renderPageLayout } from "../ui/layout.ts";
import {
  renderCrossTabMatrix,
  renderKpiGrid,
  renderRawExplorerSection,
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

export async function handleNotStableRoute(
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
    defaultSort: "limbo",
    defaultDir: "desc",
    slugBrowsers: opts.slugBrowsers,
    slugCategories: opts.slugCategories,
  });

  const actionPath = opts.actionPath ?? ctx.url.pathname;
  const canonicalUrl = buildCanonicalUrl(ctx.origin, actionPath, query);
  const browserList = formatBrowserList(query.browsers, ctx.browsers);
  const title = browserList
    ? `Not Yet Stable across ${browserList}`
    : "Not Yet Stable";
  const description = browserList
    ? `Web platform features shipped in at least one browser but still missing from all of ${browserList}, ranked by days in limbo.`
    : "Web platform features that have not yet shipped across all selected browsers.";

  if (query.warnings.length > 0 && query.format !== "html") {
    return buildExportOrErrorResponse({
      view: "not-stable",
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
      await resolveSummaryAndRows(
        ctx,
        query,
        "not-stable",
        (ev) => !ev.isStable && ev.first !== null,
      );

    const exported = buildExportOrErrorResponse({
      view: "not-stable",
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

    const limboDist = computeDistribution(
      allRows
        .map((r) => r.limboDays)
        .filter((d): d is number => d !== null),
    );

    const kpis = renderKpiGrid([
      {
        label: "Waiting Features",
        value: allRows.length.toLocaleString("en-US"),
        detail: "In ≥1 selected browser, missing elsewhere",
      },
      {
        label: "Median Days in Limbo",
        value: formatDays(limboDist.median),
        detail: `IQR: ${formatDays(limboDist.iqr)}`,
      },
      {
        label: "p90 Days in Limbo",
        value: formatDays(limboDist.p90),
        detail: `Max: ${formatDays(limboDist.max)}`,
      },
      {
        label: "Completion Rate",
        value: `${Math.round(summary.completionRate * 1000) / 10}%`,
        detail: `${summary.stableCount.toLocaleString("en-US")} already stable`,
      },
    ]);

    const missingBars = renderGenericBarsChart({
      title: "Un-Converged Backlog by Missing Browser",
      caption: "Count of un-converged features currently missing in each selected browser.",
      primaryLabel: "Missing features",
      items: query.browsers.map((b) => ({
        label: ctx.browsers.find((m) => m.id === b)?.name ?? b,
        value: summary.missingCrossTab.colTotals[b] ?? 0,
      })),
    });

    const matrixHtml = renderCrossTabMatrix(
      summary.missingCrossTab,
      ctx.browsers,
      `Count of un-converged features present in Browser A (rows) but missing from Browser B (columns). Click any count to inspect those features below.`,
      "In",
      "Missing in",
      { kind: "has-missing", actionPath, query },
    );

    const explorerHtml = renderRawExplorerSection({
      view: "not-stable",
      actionPath,
      query,
      rows: pagedRows,
      allFilteredRows: allRows,
      totalFilteredRows: totalFiltered,
      browsers: ctx.browsers,
    });

    bodyHtml = `${kpis}<h2>In Browser A, Missing in Browser B</h2>${matrixHtml}<div class="chart-grid">${missingBars}</div>${explorerHtml}`;
  }

  const controls = renderControls({
    actionPath,
    browsers: ctx.browsers,
    query,
    canonicalUrl,
  });

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
    jsonLd: buildDatasetSchema({
      origin: ctx.origin,
      canonicalUrl,
      name: title,
      description,
      manifest: ctx.manifest,
      breadcrumbs: opts.breadcrumbs,
    }),
    contentHtml: `<header class="page-intro">
      <h1>${escapeHtml(title)}</h1>
      <p class="page-lead">${escapeHtml(description)}</p>
    </header>${controls}${bodyHtml}`,
  });

  return finishHtml(html);
}
