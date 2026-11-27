import { buildCanonicalUrl, parseQuery } from "../analysis/query.ts";
import { computeAnalysisSummary, computeCrossTab, computeDistribution } from "../analysis/stats.ts";
import { formatDays, formatPct, toRowSnapshot } from "../analysis/support.ts";
import { escapeHtml } from "../formats/html.ts";
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
  filterAndSortSnapshots,
  finishHtml,
  formatBrowserList,
  loadEvaluations,
  type RouteContext,
} from "./shared.ts";
import type { CompactFeatureRowSnapshot, FeatureEvaluation } from "../types.ts";

export type LifecycleView = "experimental" | "deprecated" | "removed" | "all";

interface ViewMeta {
  path: string;
  heading: string;
  description: (browserList: string) => string;
  filter: (ev: FeatureEvaluation) => boolean;
}

const VIEW_META: Record<LifecycleView, ViewMeta> = {
  experimental: {
    path: "/experimental",
    heading: "Experimental APIs",
    description: (b) =>
      `Features currently marked experimental in MDN BCD that have shipped in at least one of ${b}.`,
    filter: (ev) => ev.status.experimental && ev.first !== null,
  },
  deprecated: {
    path: "/deprecated",
    heading: "Deprecated APIs",
    description: (b) =>
      `Features marked deprecated in MDN BCD across ${b}, comparing deprecated 'zombie' APIs still supported everywhere.`,
    filter: (ev) => ev.status.deprecated && ev.first !== null,
  },
  removed: {
    path: "/removed",
    heading: "Removed APIs",
    description: (b) =>
      `Features fully removed across all of ${b}, and how many days elapsed between the first and last browser removal.`,
    filter: (ev) => ev.removed?.isRemoved === true,
  },
  all: {
    path: "/all",
    heading: "All APIs (Explore & Export)",
    description: (b) =>
      `Full catalog of tracked features across ${b} with RFC-4180 CSV, JSON, and Markdown exports.`,
    filter: () => true,
  },
};

export async function handleLifecycleRoute(
  ctx: RouteContext,
  view: LifecycleView,
): Promise<Response> {
  const meta = VIEW_META[view];
  const validIds = ctx.browsers.map((b) => b.id);
  const query = parseQuery(ctx.request, validIds, {
    defaultSort: view === "experimental" ? "limbo" : "api",
    defaultDir: view === "experimental" ? "desc" : "asc",
  });

  // Experimental, Deprecated, and Removed are BCD status concepts
  if (view !== "all" && query.mode === "web-features") {
    query.mode = "bcd";
  }

  const canonicalUrl = buildCanonicalUrl(ctx.origin, meta.path, query);
  const browserList = formatBrowserList(query.browsers, ctx.browsers);
  const title = browserList
    ? `${meta.heading} across ${browserList}`
    : meta.heading;
  const description = meta.description(browserList || "selected browsers");

  if (query.warnings.length > 0 && query.format !== "html") {
    return buildExportOrErrorResponse({
      view,
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
    const evals = await loadEvaluations(ctx, query);
    const matched = evals.filter(meta.filter);

    let snapshots: CompactFeatureRowSnapshot[];
    if (view === "removed") {
      snapshots = matched.map((ev) => ({
        ...toRowSnapshot(ev),
        first: ev.removed!.first,
        last: ev.removed!.last,
        ageInDays: ev.removed!.ageInDays,
      }));
    } else {
      snapshots = matched.map(toRowSnapshot);
    }

    const { allFiltered, pagedRows, totalFiltered } = filterAndSortSnapshots(
      snapshots,
      query,
    );

    const summary = computeAnalysisSummary(
      matched,
      query.browsers,
      query.categories,
    );

    const exported = buildExportOrErrorResponse({
      view,
      ctx,
      query,
      title,
      description,
      canonicalUrl,
      summary,
      allRows: allFiltered,
      pagedRows,
      totalFiltered,
    });
    if (exported) return exported;

    let extraHtml = "";
    if (view === "experimental") {
      const limboDist = computeDistribution(
        matched.map((e) => e.limboDays ?? e.ageInDays ?? 0),
      );
      extraHtml = renderKpiGrid([
        { label: "Experimental APIs", value: matched.length.toLocaleString("en-US") },
        {
          label: "In All Selected",
          value: matched.filter((e) => e.isStable).length.toLocaleString("en-US"),
          detail: "Marked experimental despite broad support",
        },
        {
          label: "Median Days Experimental",
          value: formatDays(limboDist.median),
          detail: `p90: ${formatDays(limboDist.p90)}`,
        },
      ]);
    } else if (view === "deprecated") {
      const cross = computeCrossTab(matched, query.browsers);
      extraHtml = `${renderKpiGrid([
        { label: "Deprecated APIs", value: matched.length.toLocaleString("en-US") },
        {
          label: "Still in All Selected",
          value: matched.filter((e) => e.isStable).length.toLocaleString("en-US"),
          detail: "Deprecated 'zombie' APIs",
        },
        {
          label: "Median Time to Ship",
          value: formatDays(summary.distribution.median),
        },
      ])}<h2>Deprecated First-In vs. Last-In Matrix (Still Supported Everywhere)</h2>${renderCrossTabMatrix(
        cross,
        ctx.browsers,
        "Deprecated APIs currently still supported across all selected browsers.",
        "First in",
        "Last in",
      )}`;
    } else if (view === "removed") {
      const remDist = computeDistribution(
        matched.map((e) => e.removed!.ageInDays),
      );
      const removedAsStable = matched.map((e) => ({
        ...e,
        isStable: true,
        first: e.removed!.first,
        last: e.removed!.last,
      }));
      const remCross = computeCrossTab(removedAsStable, query.browsers);
      extraHtml = `${renderKpiGrid([
        { label: "Fully Removed APIs", value: matched.length.toLocaleString("en-US") },
        { label: "Median Removal Span", value: formatDays(remDist.median) },
        { label: "p90 Removal Span", value: formatDays(remDist.p90) },
      ])}<h2>First Removed vs. Last Removed Matrix</h2>${renderCrossTabMatrix(
        remCross,
        ctx.browsers,
        "Count of APIs removed in Browser A first and Browser B last.",
        "First removed from",
        "Last removed from",
      )}`;
    } else {
      extraHtml = renderKpiGrid([
        { label: "Total Matching", value: matched.length.toLocaleString("en-US") },
        {
          label: "Stable Across Selected",
          value: summary.stableCount.toLocaleString("en-US"),
          detail: formatPct(summary.completionRate),
        },
        {
          label: "Waiting (Partial Support)",
          value: summary.waitingCount.toLocaleString("en-US"),
        },
        {
          label: "Median Time to Stable",
          value: formatDays(summary.distribution.median),
        },
      ]);
    }

    const explorerHtml = renderRawExplorerSection({
      view,
      actionPath: meta.path,
      query,
      rows: pagedRows,
      totalFilteredRows: totalFiltered,
      browsers: ctx.browsers,
    });

    bodyHtml = `${extraHtml}${explorerHtml}`;
  }

  const controls = renderControls({
    actionPath: meta.path,
    browsers: ctx.browsers,
    query,
    canonicalUrl,
    showModeToggle: view === "all",
    showStrictness: view !== "removed",
  });

  const html = renderPageLayout({
    title,
    description,
    canonicalUrl,
    currentPath: meta.path,
    origin: ctx.origin,
    manifest: ctx.manifest,
    dataSource: ctx.dataSource,
    syncStatus: ctx.syncStatus,
    query,
    jsonLd: buildDatasetSchema({
      origin: ctx.origin,
      canonicalUrl,
      name: title,
      description,
      manifest: ctx.manifest,
    }),
    contentHtml: `<header class="page-intro">
      <h1>${escapeHtml(title)}</h1>
      <p class="page-lead">${escapeHtml(description)}</p>
    </header>${controls}${bodyHtml}`,
  });

  return finishHtml(html);
}
