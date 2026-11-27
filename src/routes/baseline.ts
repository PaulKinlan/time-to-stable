import { negotiateFormat } from "../analysis/query.ts";
import { cleanIsoDate, formatDays } from "../analysis/support.ts";
import { getHistorySnapshots } from "../data/history.ts";
import { buildBaselineCsv, csvResponse } from "../formats/csv.ts";
import { escapeHtml } from "../formats/html.ts";
import { jsonResponse } from "../formats/json.ts";
import { baselineToMarkdown, markdownResponse } from "../formats/markdown.ts";
import { buildRssFeed } from "../formats/rss.ts";
import { renderBaselineTrendChart } from "../ui/charts.ts";
import { renderPageLayout } from "../ui/layout.ts";
import { renderBaselineBadge, renderKpiGrid } from "../ui/tables.ts";
import { buildDatasetSchema, finishHtml, type RouteContext } from "./shared.ts";

export async function handleBaselineRoute(ctx: RouteContext): Promise<Response> {
  const format = negotiateFormat(ctx.request);
  const pre = await ctx.store.getPrecomputed();
  const summary = pre.baselineSummary;
  const canonicalUrl = `${ctx.origin}/baseline`;
  const title = "WebDX Baseline Explorer";
  const description =
    "Explore W3C WebDX Baseline Widely Available, Newly Available, and Limited Availability web features, group velocity, and upcoming 30-month graduations.";

  const params = ctx.url.searchParams;
  const q = (params.get("q") || "").trim().toLowerCase();
  const tier = params.get("baseline") || "";
  const groupFilter = params.get("group") || "";
  const page = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);
  const pageSize = 25;

  const webFeatures = await ctx.store.getWebFeatures();
  const filtered = webFeatures.filter((wf) => {
    if (tier === "high" && wf.baseline !== "high") return false;
    if (tier === "low" && wf.baseline !== "low") return false;
    if (tier === "limited" && wf.baseline !== false) return false;
    if (groupFilter && wf.group !== groupFilter) return false;
    if (q) {
      const m =
        wf.id.toLowerCase().includes(q) ||
        wf.name.toLowerCase().includes(q) ||
        wf.groupName.toLowerCase().includes(q);
      if (!m) return false;
    }
    return true;
  });

  if (format === "csv") {
    const csv = buildBaselineCsv(filtered);
    return csvResponse(csv.filename, csv.headers, csv.csvRows);
  }

  if (format === "rss") {
    const recentNewly = [...filtered]
      .filter((wf) => wf.baselineLowDate)
      .sort((a, b) =>
        cleanIsoDate(b.baselineLowDate ?? "").localeCompare(
          cleanIsoDate(a.baselineLowDate ?? ""),
        ),
      )
      .slice(0, 40);

    return buildRssFeed({
      title: "Baseline Newly Available Features — Time to Stable",
      description:
        "Web platform features recently achieving Baseline Newly Available status across core browsers.",
      link: canonicalUrl,
      selfLink: `${canonicalUrl}?type=rss`,
      updatedIso: ctx.manifest.bcdTimestamp,
      items: recentNewly.map((wf) => ({
        title: `${wf.name} (${wf.baseline === "high" ? "Widely Available" : "Newly Available"})`,
        id: `${ctx.origin}/feature/${wf.id}`,
        link: `${ctx.origin}/feature/${wf.id}`,
        pubDateIso: `${cleanIsoDate(wf.baselineLowDate ?? "")}T00:00:00Z`,
        htmlContent: `<p>${escapeHtml(wf.description)}</p><p>Group: ${escapeHtml(wf.groupName)} · Baseline date: ${escapeHtml(wf.baselineLowDate ?? "")}</p>`,
      })),
    });
  }

  if (format === "json") {
    const history = await getHistorySnapshots(ctx.env);
    return jsonResponse({
      meta: {
        title,
        description,
        canonicalUrl,
        bcdVersion: ctx.manifest.bcdVersion,
        webFeaturesVersion: ctx.manifest.webFeaturesVersion,
      },
      summary,
      history,
      pagination: {
        page,
        pageSize,
        total: filtered.length,
        totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      },
      rows: filtered.slice((page - 1) * pageSize, page * pageSize),
    });
  }

  if (format === "md") {
    return markdownResponse(
      baselineToMarkdown(summary, filtered, canonicalUrl, ctx.manifest),
    );
  }

  const history = await getHistorySnapshots(ctx.env);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((curPage - 1) * pageSize, curPage * pageSize);

  const kpis = renderKpiGrid([
    {
      label: "Total Web Features",
      value: summary.total.toLocaleString("en-US"),
      detail: `web-features v${ctx.manifest.webFeaturesVersion}`,
    },
    {
      label: "Widely Available",
      value: summary.high.toLocaleString("en-US"),
      detail: `${Math.round((summary.high / Math.max(1, summary.total)) * 1000) / 10}% of platform`,
    },
    {
      label: "Newly Available",
      value: summary.low.toLocaleString("en-US"),
      detail: "Interoperable (<30 months old)",
    },
    {
      label: "Limited Availability",
      value: summary.limited.toLocaleString("en-US"),
      detail: "Missing in ≥1 core target",
    },
    {
      label: "Graduating Soon (≤6m)",
      value: String(summary.approachingWidelyAvailable.length),
      detail: "Entering Widely Available",
    },
  ]);

  const trendChart = `<div class="chart-grid">${renderBaselineTrendChart(summary)}</div>`;

  const upcomingRows = summary.approachingWidelyAvailable
    .map(
      (a) => `<tr>
    <td><a href="/feature/${encodeURIComponent(a.id)}">${escapeHtml(a.name)}</a></td>
    <td>${escapeHtml(a.groupName)}</td>
    <td class="num">${escapeHtml(a.baselineLowDate)}</td>
    <td class="num">${escapeHtml(a.expectedHighDate)}</td>
    <td class="num">${a.daysUntilHigh}d</td>
  </tr>`,
    )
    .join("");

  const approachingSection = upcomingRows
    ? `<h2>Approaching Widely Available (Next 6 Months)</h2>
    <div class="table-wrap"><table class="data-table">
      <caption>Baseline Newly Available features projected to pass the 30-month Widely Available milestone within 185 days.</caption>
      <thead><tr><th>Feature</th><th>Group</th><th class="num">Newly Available</th><th class="num">Projected Widely</th><th class="num">Days Left</th></tr></thead>
      <tbody>${upcomingRows}</tbody>
    </table></div>`
    : "";

  const groupRows = summary.byGroup
    .slice(0, 20)
    .map(
      (g) => `<tr>
    <td><a href="/baseline?group=${encodeURIComponent(g.group)}#baseline-explorer">${escapeHtml(g.groupName)}</a></td>
    <td class="num">${g.total}</td>
    <td class="num">${g.high}</td>
    <td class="num">${g.low}</td>
    <td class="num">${g.limited}</td>
    <td class="num">${g.widelyPct}%</td>
    <td class="num">${escapeHtml(formatDays(g.medianTtaDays))}</td>
  </tr>`,
    )
    .join("");

  const historySection =
    history.length > 0
      ? `<h2>Release Snapshot History</h2>
      <div class="table-wrap"><table class="data-table">
        <caption>Dataset snapshots recorded across BCD &amp; web-features releases.</caption>
        <thead><tr><th>Date</th><th>BCD</th><th>web-features</th><th class="num">Core-3 Stable</th><th class="num">Widely</th><th class="num">Newly</th><th class="num">Limited</th></tr></thead>
        <tbody>${[...history]
          .reverse()
          .slice(0, 12)
          .map(
            (h) => `<tr><td>${escapeHtml(h.date)}</td><td>${escapeHtml(h.bcdVersion)}</td><td>${escapeHtml(h.webFeaturesVersion)}</td><td class="num">${h.core3StableBcd.toLocaleString("en-US")}</td><td class="num">${h.baselineHigh}</td><td class="num">${h.baselineLow}</td><td class="num">${h.baselineLimited}</td></tr>`,
          )
          .join("")}</tbody>
      </table></div>`
      : "";

  const explorerRows = pageRows
    .map(
      (f) => `<tr>
    <td><strong><a href="/feature/${encodeURIComponent(f.id)}">${escapeHtml(f.name)}</a></strong><br><code class="mono">${escapeHtml(f.id)}</code></td>
    <td>${escapeHtml(f.groupName)}</td>
    <td>${renderBaselineBadge(f.baseline)}</td>
    <td class="num">${escapeHtml(f.baselineLowDate ?? "—")}</td>
    <td class="num">${f.compatCount}</td>
  </tr>`,
    )
    .join("");

  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (tier) sp.set("baseline", tier);
    if (groupFilter) sp.set("group", groupFilter);
    sp.set("page", String(p));
    return `/baseline?${sp.toString()}#baseline-explorer`;
  };

  const html = renderPageLayout({
    title,
    description,
    canonicalUrl,
    currentPath: "/baseline",
    origin: ctx.origin,
    manifest: ctx.manifest,
    dataSource: ctx.dataSource,
    syncStatus: ctx.syncStatus,
    rssUrl: `${canonicalUrl}?type=rss`,
    breadcrumbs: [{ label: "Home", href: "/" }, { label: "Baseline Explorer" }],
    jsonLd: buildDatasetSchema({
      origin: ctx.origin,
      canonicalUrl,
      name: title,
      description,
      manifest: ctx.manifest,
      breadcrumbs: [{ label: "Home", href: "/" }, { label: "Baseline Explorer" }],
    }),
    contentHtml: `<header class="page-intro">
      <h1>${escapeHtml(title)}</h1>
      <p class="page-lead">${escapeHtml(description)}</p>
      <div class="export-links">
        <a class="btn" href="/compare/baseline-core-7?mode=web-features">Compare All 7 Baseline Browsers</a>
        <a class="btn" href="/baseline?type=csv">CSV</a>
        <a class="btn" href="/baseline?type=json">JSON</a>
        <a class="btn" href="/baseline?type=md">Markdown</a>
        <a class="btn" href="/baseline?type=rss">RSS Feed</a>
      </div>
    </header>
    ${kpis}
    ${trendChart}
    ${approachingSection}
    <h2>Top WebDX Feature Groups</h2>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Group</th><th class="num">Total</th><th class="num">Widely</th><th class="num">Newly</th><th class="num">Limited</th><th class="num">Widely %</th><th class="num">Median TTA</th></tr></thead>
      <tbody>${groupRows}</tbody>
    </table></div>
    ${historySection}
    <section id="baseline-explorer" class="below-fold-section">
      <h2>All Web Features (${filtered.length.toLocaleString("en-US")} matching)</h2>
      <search>
        <form class="search-bar" method="GET" action="/baseline#baseline-explorer">
          <input type="search" name="q" value="${escapeHtml(params.get("q") || "")}" placeholder="Search web features (e.g. subgrid, popover, view transitions)...">
          <select name="baseline">
            <option value="">All Baseline tiers</option>
            <option value="high"${tier === "high" ? " selected" : ""}>Widely Available</option>
            <option value="low"${tier === "low" ? " selected" : ""}>Newly Available</option>
            <option value="limited"${tier === "limited" ? " selected" : ""}>Limited</option>
          </select>
          <select name="group">
            <option value="">All groups</option>
            ${summary.byGroup
              .map(
                (g) =>
                  `<option value="${escapeHtml(g.group)}"${groupFilter === g.group ? " selected" : ""}>${escapeHtml(g.groupName)} (${g.total})</option>`,
              )
              .join("")}
          </select>
          <button type="submit" class="btn btn-primary">Filter</button>
        </form>
      </search>
      <div class="pagination">
        <span>Page ${curPage} of ${totalPages} (${filtered.length.toLocaleString("en-US")} features)</span>
        <div class="pagination-controls">
          ${curPage > 1 ? `<a class="btn" href="${escapeHtml(pageHref(curPage - 1))}">Previous</a>` : '<span class="btn" aria-disabled="true">Previous</span>'}
          ${curPage < totalPages ? `<a class="btn" href="${escapeHtml(pageHref(curPage + 1))}">Next</a>` : '<span class="btn" aria-disabled="true">Next</span>'}
        </div>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Feature</th><th>Group</th><th>Baseline</th><th class="num">Newly Available</th><th class="num">BCD Keys</th></tr></thead>
        <tbody>${explorerRows}</tbody>
      </table></div>
    </section>`,
  });

  return finishHtml(html);
}
