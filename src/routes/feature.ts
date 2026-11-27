import { CATEGORY_LABELS, negotiateFormat } from "../analysis/query.ts";
import {
  DEFAULT_SUPPORT_OPTIONS,
  epochDayToIso,
  evaluateFeatureSupport,
  evaluateWebFeatureSupport,
  expandMdnUrl,
  formatDays,
} from "../analysis/support.ts";
import { escapeHtml } from "../formats/html.ts";
import { jsonResponse } from "../formats/json.ts";
import { featureToMarkdown, markdownResponse } from "../formats/markdown.ts";
import { renderFeatureTimelineSvg } from "../ui/charts.ts";
import { renderPageLayout } from "../ui/layout.ts";
import { renderCompactNotes } from "../ui/notes.ts";
import { renderBaselineBadge, renderKpiGrid } from "../ui/tables.ts";
import { buildDatasetSchema, finishHtml, type RouteContext } from "./shared.ts";
import type { TimelinePoint } from "../types.ts";

export async function handleFeatureRoute(
  ctx: RouteContext,
  rawId: string,
): Promise<Response | null> {
  const format = negotiateFormat(ctx.request);
  const lookup = await ctx.store.lookupFeature(rawId);
  if (!lookup) return null;

  const canonicalId =
    lookup.kind === "web-feature"
      ? lookup.webFeature!.id
      : lookup.bcdFeature!.id;
  const canonicalUrl = `${ctx.origin}/feature/${encodeURIComponent(canonicalId)}`;

  if (format === "json") {
    return jsonResponse({
      meta: {
        canonicalUrl,
        bcdVersion: ctx.manifest.bcdVersion,
        webFeaturesVersion: ctx.manifest.webFeaturesVersion,
      },
      ...lookup,
    });
  }

  if (format === "md") {
    return markdownResponse(
      featureToMarkdown(lookup, ctx.browsers, ctx.manifest, canonicalUrl),
    );
  }

  const allBrowserIds = ctx.browsers.map((b) => b.id);
  const core3 = ["chrome", "firefox", "safari"];

  if (lookup.kind === "web-feature" && lookup.webFeature) {
    const wf = lookup.webFeature;
    const coreEval = evaluateWebFeatureSupport(
      wf,
      core3,
      ctx.manifest.bcdEpochDay,
    );
    const timeline: TimelinePoint[] = Object.entries(wf.s)
      .map(([b, s]) => ({
        browser: b,
        version: s.v,
        day: s.d,
        approx: s.le === 1,
      }))
      .sort((a, b) => a.day - b.day);

    const kpis = renderKpiGrid([
      {
        label: "Baseline Status",
        value:
          wf.baseline === "high"
            ? "Widely Available"
            : wf.baseline === "low"
            ? "Newly Available"
            : "Limited",
        detail: wf.baselineLowDate ? `Since ${wf.baselineLowDate}` : "Missing ≥1 target",
      },
      {
        label: "First Core Launch",
        value: coreEval.first
          ? `${ctx.browsers.find((b) => b.id === coreEval.first!.browser)?.shortName ?? coreEval.first.browser} ${coreEval.first.version}`
          : "—",
        detail: coreEval.first ? epochDayToIso(coreEval.first.day) : undefined,
      },
      {
        label: "Core-3 Stability",
        value: coreEval.isStable
          ? formatDays(coreEval.ageInDays)
          : `Limbo (${formatDays(coreEval.limboDays)})`,
        detail: coreEval.isStable && coreEval.last
          ? `Last: ${ctx.browsers.find((b) => b.id === coreEval.last!.browser)?.shortName ?? coreEval.last.browser} (${epochDayToIso(coreEval.last.day)})`
          : `Missing: ${coreEval.missingBrowsers.join(", ") || "—"}`,
      },
      {
        label: "BCD Keys Mapped",
        value: String(wf.compatCount),
        detail: `Group: ${wf.groupName}`,
      },
    ]);

    const timelineChart = renderFeatureTimelineSvg(timeline, ctx.browsers);
    const supportRows = timeline
      .map((t) => {
        const meta = ctx.browsers.find((b) => b.id === t.browser);
        return `<tr>
        <th scope="row">${escapeHtml(meta?.name ?? t.browser)}</th>
        <td>${escapeHtml(meta?.type ?? "browser")}</td>
        <td class="mono">${escapeHtml(t.approx ? `≤${t.version}` : t.version)}</td>
        <td class="num">${escapeHtml(epochDayToIso(t.day))}</td>
      </tr>`;
      })
      .join("");

    const relatedRows = (lookup.relatedBcdFeatures ?? [])
      .map((f) => {
        const ev = evaluateFeatureSupport(
          f,
          core3,
          DEFAULT_SUPPORT_OPTIONS,
          ctx.manifest.bcdEpochDay,
        );
        return `<tr>
        <td><a class="mono" href="/feature/${encodeURIComponent(f.id)}">${escapeHtml(f.id)}</a></td>
        <td>${escapeHtml(CATEGORY_LABELS[f.cat])}</td>
        <td class="num">${ev.isStable ? escapeHtml(formatDays(ev.ageInDays)) : `${escapeHtml(formatDays(ev.limboDays))} limbo`}</td>
      </tr>`;
      })
      .join("");

    const html = renderPageLayout({
      title: `${wf.name} — Browser Stability & Timeline`,
      description: `${wf.description} Track when ${wf.name} landed across browsers and reached Baseline.`,
      canonicalUrl,
      currentPath: "/baseline",
      origin: ctx.origin,
      manifest: ctx.manifest,
      dataSource: ctx.dataSource,
      syncStatus: ctx.syncStatus,
      breadcrumbs: [
        { label: "Home", href: "/" },
        { label: "Baseline", href: "/baseline" },
        { label: wf.name },
      ],
      jsonLd: buildDatasetSchema({
        origin: ctx.origin,
        canonicalUrl,
        name: wf.name,
        description: wf.description,
        manifest: ctx.manifest,
        breadcrumbs: [
          { label: "Home", href: "/" },
          { label: "Baseline", href: "/baseline" },
          { label: wf.name },
        ],
      }),
      contentHtml: `<header class="page-intro">
        <div>${renderBaselineBadge(wf.baseline)} <span class="badge badge-limited">${escapeHtml(wf.groupName)}</span></div>
        <h1>${escapeHtml(wf.name)}</h1>
        <p class="page-lead">${escapeHtml(wf.description)}</p>
        <div class="export-links">
          ${wf.spec ? `<a class="btn" href="${escapeHtml(wf.spec)}" target="_blank" rel="noopener">Specification</a>` : ""}
          <a class="btn" href="/feature/${encodeURIComponent(wf.id)}?type=md">Markdown</a>
          <a class="btn" href="/feature/${encodeURIComponent(wf.id)}?type=json">JSON</a>
        </div>
      </header>
      ${kpis}
      ${timelineChart}
      <h2>Browser Support Releases</h2>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Browser</th><th>Type</th><th>Version</th><th class="num">Release Date</th></tr></thead>
        <tbody>${supportRows || '<tr><td colspan="4">No dated releases recorded.</td></tr>'}</tbody>
      </table></div>
      ${
        relatedRows
          ? `<h2>Constituent MDN BCD Keys (Sample)</h2>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>BCD Key</th><th>Area</th><th class="num">Core-3 TTA</th></tr></thead>
        <tbody>${relatedRows}</tbody>
      </table></div>`
          : ""
      }`,
    });

    return finishHtml(html);
  }

  const bcd = lookup.bcdFeature!;
  const allEval = evaluateFeatureSupport(
    bcd,
    allBrowserIds,
    DEFAULT_SUPPORT_OPTIONS,
    ctx.manifest.bcdEpochDay,
  );
  const coreEval = evaluateFeatureSupport(
    bcd,
    core3,
    DEFAULT_SUPPORT_OPTIONS,
    ctx.manifest.bcdEpochDay,
  );
  const mdnUrl = expandMdnUrl(bcd.mdn);

  const kpis = renderKpiGrid([
    {
      label: "Specification Area",
      value: CATEGORY_LABELS[bcd.cat],
      detail: coreEval.status.deprecated
        ? "Deprecated"
        : coreEval.status.experimental
        ? "Experimental"
        : "Standard track",
    },
    {
      label: "First Core Launch",
      value: coreEval.first
        ? `${ctx.browsers.find((b) => b.id === coreEval.first!.browser)?.shortName ?? coreEval.first.browser} ${coreEval.first.version}`
        : "—",
      detail: coreEval.first ? epochDayToIso(coreEval.first.day) : undefined,
    },
    {
      label: "Core-3 Stability",
      value: coreEval.isStable
        ? formatDays(coreEval.ageInDays)
        : coreEval.limboDays !== null
        ? `Limbo (${formatDays(coreEval.limboDays)})`
        : "No core support",
      detail: coreEval.last
        ? `Last: ${ctx.browsers.find((b) => b.id === coreEval.last!.browser)?.shortName ?? coreEval.last.browser} (${epochDayToIso(coreEval.last.day)})`
        : undefined,
    },
    {
      label: "Baseline Feature",
      value: bcd.bl === "high" ? "Widely" : bcd.bl === "low" ? "Newly" : "Limited / Unmapped",
      detail: lookup.webFeature ? lookup.webFeature.name : undefined,
    },
  ]);

  const timelineChart = renderFeatureTimelineSvg(
    allEval.browserTimeline,
    ctx.browsers,
  );

  const rowsHtml = ctx.browsers
    .map((b) => {
      const pt = allEval.browserTimeline.find((t) => t.browser === b.id);
      const raw = bcd.s[b.id];
      const caveat = raw?.p
        ? `Partial (${raw.p[0]})`
        : raw?.x
        ? `Prefixed (${raw.x[0]})`
        : raw?.f
        ? `Flagged (${raw.f[0]})`
        : raw?.rv
        ? `Removed (${raw.rv})`
        : "—";
      return `<tr>
      <th scope="row">${escapeHtml(b.name)}</th>
      <td>${escapeHtml(b.type)}</td>
      <td class="mono">${pt ? escapeHtml(pt.approx ? `≤${pt.version}` : pt.version) : "—"}</td>
      <td class="num">${pt ? escapeHtml(epochDayToIso(pt.day)) : "—"}</td>
      <td>${escapeHtml(pt ? "Supported" : caveat)}</td>
    </tr>`;
    })
    .join("");

  const html = renderPageLayout({
    title: `${bcd.id} — Browser Support Timeline`,
    description: `Browser release timeline and cross-engine time-to-stable for MDN BCD key ${bcd.id}.`,
    canonicalUrl,
    currentPath: "/all",
    origin: ctx.origin,
    manifest: ctx.manifest,
    dataSource: ctx.dataSource,
    syncStatus: ctx.syncStatus,
    breadcrumbs: [
      { label: "Home", href: "/" },
      { label: CATEGORY_LABELS[bcd.cat], href: `/compare/chrome-vs-firefox-vs-safari/${bcd.cat}` },
      { label: bcd.id },
    ],
    jsonLd: buildDatasetSchema({
      origin: ctx.origin,
      canonicalUrl,
      name: bcd.id,
      description: `Browser release compatibility history for ${bcd.id}.`,
      manifest: ctx.manifest,
    }),
    contentHtml: `<header class="page-intro">
      <div>${renderBaselineBadge(bcd.bl)} <span class="badge badge-limited">${escapeHtml(CATEGORY_LABELS[bcd.cat])}</span></div>
      <h1><code class="mono">${escapeHtml(bcd.id)}</code></h1>
      <p class="page-lead">Granular MDN Browser Compat Data support history across ${allEval.browserTimeline.length} tracked browsers.</p>
      <div class="export-links">
        ${lookup.webFeature ? `<a class="btn btn-primary" href="/feature/${encodeURIComponent(lookup.webFeature.id)}">Web Feature: ${escapeHtml(lookup.webFeature.name)}</a>` : ""}
        ${mdnUrl ? `<a class="btn" href="${escapeHtml(mdnUrl)}" target="_blank" rel="noopener">MDN Docs</a>` : ""}
        ${bcd.spec ? `<a class="btn" href="${escapeHtml(bcd.spec)}" target="_blank" rel="noopener">Spec</a>` : ""}
        <a class="btn" href="/feature/${encodeURIComponent(bcd.id)}?type=md">Markdown</a>
        <a class="btn" href="/feature/${encodeURIComponent(bcd.id)}?type=json">JSON</a>
      </div>
    </header>
    ${kpis}
    ${timelineChart}
    ${renderCompactNotes(bcd.notes, ctx.browsers)}
    <h2>Full Browser Compatibility Table</h2>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Browser</th><th>Type</th><th>Version</th><th class="num">Release Date</th><th>Status / Caveats</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>`,
  });

  return finishHtml(html);
}
