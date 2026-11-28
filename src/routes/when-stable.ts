import {
  buildCanonicalUrl,
  buildSelectionParams,
  CATEGORY_LABELS,
  parseQuery,
} from "../analysis/query.ts";
import {
  epochDayToIso,
  epochDayToYearMonth,
  formatDays,
} from "../analysis/support.ts";
import { escapeHtml } from "../formats/html.ts";
import { buildRssFeed } from "../formats/rss.ts";
import { renderGenericBarsChart } from "../ui/charts.ts";
import { renderControls } from "../ui/controls.ts";
import { renderPageLayout } from "../ui/layout.ts";
import {
  renderBaselineBadge,
  renderKpiGrid,
  renderRawExplorerSection,
  renderTimelineChips,
} from "../ui/tables.ts";
import {
  buildDatasetSchema,
  buildExportOrErrorResponse,
  finishHtml,
  formatBrowserList,
  resolveSummaryAndRows,
  type RouteContext,
} from "./shared.ts";
import type { CategorySlug, CompactFeatureRowSnapshot } from "../types.ts";

export async function handleWhenStableRoute(
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
    defaultSort: "lastDate",
    defaultDir: "desc",
    slugBrowsers: opts.slugBrowsers,
    slugCategories: opts.slugCategories,
  });

  const actionPath = opts.actionPath ?? ctx.url.pathname;
  const canonicalUrl = buildCanonicalUrl(ctx.origin, actionPath, query);
  const browserList = formatBrowserList(query.browsers, ctx.browsers);
  const title = browserList
    ? `Now Stable across ${browserList}`
    : "Now Stable";
  const description = browserList
    ? `Reverse-chronological timeline and RSS feed of when web features achieved full support across ${browserList}.`
    : "Reverse-chronological feed of when web platform features reached cross-browser stability.";

  const qs = buildSelectionParams(query);
  const rssUrl = `${ctx.origin}/when-stable?${qs ? `${qs}&` : ""}type=rss`;

  if (query.warnings.length > 0 && query.format !== "html") {
    return buildExportOrErrorResponse({
      view: "when-stable",
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
      await resolveSummaryAndRows(ctx, query, "when-stable", (ev) => ev.isStable);

    if (query.format === "rss") {
      const monthGroups = new Map<string, CompactFeatureRowSnapshot[]>();
      const sortedRecent = [...allRows].sort(
        (a, b) => (b.last?.day ?? 0) - (a.last?.day ?? 0),
      );
      for (const r of sortedRecent) {
        if (!r.last) continue;
        const ym = epochDayToYearMonth(r.last.day);
        let arr = monthGroups.get(ym);
        if (!arr) {
          arr = [];
          monthGroups.set(ym, arr);
        }
        arr.push(r);
        if (monthGroups.size >= 36 && !monthGroups.has(ym)) break;
      }

      const items = [...monthGroups.entries()].slice(0, 36).map(([ym, group]) => {
        const tableRows = group
          .map((r) => {
            const name = r.name ? `${r.name} (${r.id})` : r.id;
            const link = `${ctx.origin}/feature/${encodeURIComponent(r.id)}`;
            const firstB = r.first
              ? `${ctx.browsers.find((b) => b.id === r.first!.browser)?.name ?? r.first.browser} (${epochDayToIso(r.first.day)})`
              : "—";
            const lastB = r.last
              ? `${ctx.browsers.find((b) => b.id === r.last!.browser)?.name ?? r.last.browser} (${epochDayToIso(r.last.day)})`
              : "—";
            return `<tr><td><a href="${escapeHtml(link)}">${escapeHtml(name)}</a></td><td>${escapeHtml(CATEGORY_LABELS[r.cat])}</td><td>${escapeHtml(firstB)}</td><td>${escapeHtml(lastB)}</td><td>${escapeHtml(formatDays(r.ageInDays))}</td></tr>`;
          })
          .join("");
        const htmlTable = `<p>${group.length} features became stable across ${escapeHtml(browserList)} in ${escapeHtml(ym)}.</p><table><thead><tr><th>Feature</th><th>Area</th><th>First</th><th>Last</th><th>Wait</th></tr></thead><tbody>${tableRows}</tbody></table>`;
        return {
          title: `${ym} — ${group.length} features now stable across ${browserList}`,
          id: `${canonicalUrl}#${ym}`,
          link: `${canonicalUrl}#month-${ym}`,
          pubDateIso: `${ym}-01T00:00:00Z`,
          htmlContent: htmlTable,
        };
      });

      return buildRssFeed({
        title,
        description,
        link: canonicalUrl,
        selfLink: rssUrl,
        updatedIso: ctx.manifest.bcdTimestamp,
        items,
      });
    }

    const exported = buildExportOrErrorResponse({
      view: "when-stable",
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

    // Monthly velocity over the latest 12 active months
    const monthCounts = new Map<string, number>();
    for (const r of allRows) {
      if (!r.last) continue;
      const ym = epochDayToYearMonth(r.last.day);
      monthCounts.set(ym, (monthCounts.get(ym) ?? 0) + 1);
    }
    const recentMonths = [...monthCounts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12);

    const kpis = renderKpiGrid([
      {
        label: "Total Stable",
        value: allRows.length.toLocaleString("en-US"),
        detail: `Newest: ${pagedRows[0]?.last ? epochDayToIso(pagedRows[0].last.day) : "—"}`,
      },
      {
        label: "Median Time to Stable",
        value: formatDays(summary.distribution.median),
        detail: `p90: ${formatDays(summary.distribution.p90)}`,
      },
      {
        label: "Latest Active Month",
        value: recentMonths.length
          ? `${recentMonths[recentMonths.length - 1][0]} (${recentMonths[recentMonths.length - 1][1]})`
          : "—",
        detail: "Features reaching all selected browsers",
      },
    ]);

    const velocityChart = renderGenericBarsChart({
      title: "Recent Monthly Stability Waves",
      caption: "Number of features reaching full stability across all selected browsers per month.",
      primaryLabel: "Features stabilized",
      items: recentMonths.map(([ym, count]) => ({ label: ym, value: count })),
    });

    // Group paged rows by month for clean reverse-chronological reading
    const groupedPage = new Map<string, CompactFeatureRowSnapshot[]>();
    for (const r of pagedRows) {
      const ym = r.last ? epochDayToYearMonth(r.last.day) : "Unknown";
      let arr = groupedPage.get(ym);
      if (!arr) {
        arr = [];
        groupedPage.set(ym, arr);
      }
      arr.push(r);
    }

    const monthlySections = [...groupedPage.entries()]
      .map(([ym, items]) => {
        const rowsHtml = items
          .map(
            (r) => `<tr>
          <td><a href="/feature/${encodeURIComponent(r.id)}">${escapeHtml(r.name ?? r.id)}</a></td>
          <td>${escapeHtml(CATEGORY_LABELS[r.cat])}</td>
          <td>${renderBaselineBadge(r.baseline)}</td>
          <td>${renderTimelineChips(r, ctx.browsers)}</td>
          <td class="num">${escapeHtml(formatDays(r.ageInDays))}</td>
        </tr>`,
          )
          .join("");
        return `<h3 id="month-${escapeHtml(ym)}">${escapeHtml(ym)} (${items.length} shown)</h3>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Feature</th><th>Area</th><th>Baseline</th><th>Browser Timeline</th><th class="num">Wait</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
      })
      .join("");

    const explorerHtml = renderRawExplorerSection({
      view: "when-stable",
      actionPath,
      query,
      rows: pagedRows,
      allFilteredRows: allRows,
      totalFilteredRows: totalFiltered,
      browsers: ctx.browsers,
    });

    bodyHtml = `${kpis}<div class="chart-grid">${velocityChart}</div><h2>Monthly Stability Feed</h2>${monthlySections}${explorerHtml}`;
  }

  const controls = renderControls({
    actionPath,
    browsers: ctx.browsers,
    query,
    canonicalUrl,
    showExportRss: true,
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
    rssUrl,
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
