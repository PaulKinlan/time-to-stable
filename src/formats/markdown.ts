import { CATEGORY_LABELS } from "../analysis/query.ts";
import {
  epochDayToIso,
  expandMdnUrl,
  formatDays,
  formatPct,
} from "../analysis/support.ts";
import type {
  AnalysisSummary,
  BaselineSummary,
  BrowserMeta,
  CompactFeatureRowSnapshot,
  CompactWebFeature,
  FeatureLookupResult,
  Manifest,
  ParsedQuery,
  StoryPayload,
} from "../types.ts";

function browserShort(id: string, browsers: readonly BrowserMeta[]): string {
  return browsers.find((b) => b.id === id)?.shortName ?? id;
}

function browserName(id: string, browsers: readonly BrowserMeta[]): string {
  return browsers.find((b) => b.id === id)?.name ?? id;
}

function mdTable(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
): string {
  const sep = headers.map(() => "---").join(" | ");
  const head = headers.join(" | ");
  const body = rows
    .map((r) =>
      r
        .map((c) => String(c).replace(/\|/g, "\\|").replace(/\n/g, " "))
        .join(" | "),
    )
    .join("\n");
  return `| ${head} |\n| ${sep} |\n${body ? body.split("\n").map((l) => `| ${l} |`).join("\n") : ""}`;
}

export function markdownResponse(markdown: string, status = 200): Response {
  return new Response(markdown, {
    status,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
    },
  });
}

export function renderAnalysisMarkdown(opts: {
  title: string;
  description: string;
  canonicalUrl: string;
  manifest: Manifest;
  query: ParsedQuery;
  browsers: readonly BrowserMeta[];
  summary?: AnalysisSummary;
  rows: readonly CompactFeatureRowSnapshot[];
  totalRows: number;
}): string {
  const {
    title,
    description,
    canonicalUrl,
    manifest,
    query,
    browsers,
    summary,
    rows,
    totalRows,
  } = opts;
  const browserNames = query.browsers.map((b) => browserName(b, browsers)).join(", ");
  const catNames = query.categories.map((c) => CATEGORY_LABELS[c]).join(", ");

  const lines: string[] = [
    "---",
    `title: "${title}"`,
    `canonical: "${canonicalUrl}"`,
    `bcd_version: "${manifest.bcdVersion}"`,
    `bcd_timestamp: "${manifest.bcdTimestamp}"`,
    `web_features_version: "${manifest.webFeaturesVersion}"`,
    `mode: "${query.mode}"`,
    `browsers: [${query.browsers.join(", ")}]`,
    `categories: [${query.categories.join(", ")}]`,
    "---",
    "",
    `# ${title}`,
    "",
    description,
    "",
    `- **Scope**: ${browserNames || "All"} | Categories: ${catNames || "All"} | Granularity: \`${query.mode}\``,
    `- **Data**: MDN BCD \`v${manifest.bcdVersion}\` + WebDX web-features \`v${manifest.webFeaturesVersion}\``,
    "",
  ];

  if (summary) {
    lines.push("## Summary Metrics", "");
    lines.push(
      `- **Landed in >=1 selected browser**: ${summary.totalLanded.toLocaleString("en-US")}`,
      `- **Stable across all selected**: ${summary.stableCount.toLocaleString("en-US")} (${formatPct(summary.completionRate)})`,
      `- **Still waiting (right-censored)**: ${summary.waitingCount.toLocaleString("en-US")}`,
      `- **Median time to stable**: ${formatDays(summary.distribution.median)} (IQR: ${formatDays(summary.distribution.iqr)}, p90: ${formatDays(summary.distribution.p90)}, Mean: ${formatDays(summary.distribution.mean)})`,
      `- **Kaplan-Meier probability stable**: 1y = ${formatPct(summary.survival.probStableBy.d365, false)}, 2y = ${formatPct(summary.survival.probStableBy.d730, false)}, KM median = ${formatDays(summary.survival.kmMedianDays)}`,
      "",
    );

    if (summary.byCategory.length > 0) {
      lines.push("## Category Breakdown", "");
      lines.push(
        mdTable(
          ["Category", "Landed", "Stable", "Waiting", "Complete", "1y KM%", "Median", "p90"],
          summary.byCategory.map((c) => [
            CATEGORY_LABELS[c.category],
            c.totalLanded,
            c.stableCount,
            c.waitingCount,
            formatPct(c.completionRate),
            formatPct(c.km1yPct, false),
            formatDays(c.medianDays),
            formatDays(c.p90Days),
          ]),
        ),
        "",
      );
    }

    if (summary.yearlyCohorts.length > 0) {
      lines.push("## Recent Yearly Cohorts (Right-Censoring Aware)", "");
      const recentYears = [...summary.yearlyCohorts].reverse().slice(0, 12);
      lines.push(
        mdTable(
          ["Year", "Landed", "Stable", "Complete", "1y KM%", "Median", "p90", "Note"],
          recentYears.map((y) => [
            y.year,
            y.totalLanded,
            y.stableCount,
            formatPct(y.completionRate),
            formatPct(y.km1yPct, false),
            formatDays(y.medianDays),
            formatDays(y.p90Days),
            y.isRightCensored ? "Right-censored (<80% complete)" : "Mature",
          ]),
        ),
        "",
      );
    }
  }

  lines.push(
    `## Features (Showing ${rows.length} of ${totalRows.toLocaleString("en-US")})`,
    "",
  );
  lines.push(
    mdTable(
      ["Feature", "Category", "First", "Last", "Days / Limbo", "Baseline"],
      rows.slice(0, 30).map((r) => [
        r.name ? `${r.name} (\`${r.id}\`)` : `\`${r.id}\``,
        CATEGORY_LABELS[r.cat],
        r.first ? `${browserShort(r.first.browser, browsers)} (${epochDayToIso(r.first.day)})` : "—",
        r.last ? `${browserShort(r.last.browser, browsers)} (${epochDayToIso(r.last.day)})` : "Missing",
        r.ageInDays !== null ? formatDays(r.ageInDays) : `${formatDays(r.limboDays)} limbo`,
        r.baseline === "high" ? "Widely" : r.baseline === "low" ? "Newly" : "Limited",
      ]),
    ),
    "",
    "> Machine-readable links: `?type=json` | `?type=csv` | `/llms.txt` | `/openapi.json`",
  );

  return `${lines.join("\n")}\n`;
}

export function storyToMarkdown(
  story: StoryPayload,
  canonicalUrl: string,
  manifest: Manifest,
): string {
  const lines: string[] = [
    "---",
    `title: "${story.title}"`,
    `slug: "${story.slug}"`,
    `canonical: "${canonicalUrl}"`,
    `bcd_version: "${manifest.bcdVersion}"`,
    `web_features_version: "${manifest.webFeaturesVersion}"`,
    "---",
    "",
    `# ${story.title}`,
    "",
    `*${story.subtitle}*`,
    "",
    story.summary,
    "",
    "## Key Takeaways",
    "",
    ...story.keyTakeaways.map((t) => `- ${t}`),
    "",
    "## Headline Metrics",
    "",
    ...story.metrics.map((m) => `- **${m.label}**: ${m.value}${m.detail ? ` (${m.detail})` : ""}`),
    "",
    `## Methodology`,
    "",
    story.methodology,
    "",
  ];

  for (const table of story.tables) {
    lines.push(`## ${table.title}`, "");
    lines.push(mdTable(table.columns, table.rows), "");
  }

  lines.push("> Explore more stories at `/stories` or machine specs at `/openapi.json` and `/llms.txt`.");
  return `${lines.join("\n")}\n`;
}

export function baselineToMarkdown(
  summary: BaselineSummary,
  features: readonly CompactWebFeature[],
  canonicalUrl: string,
  manifest: Manifest,
): string {
  const lines: string[] = [
    "---",
    `title: "WebDX Baseline Explorer"`,
    `canonical: "${canonicalUrl}"`,
    `bcd_version: "${manifest.bcdVersion}"`,
    `web_features_version: "${manifest.webFeaturesVersion}"`,
    "---",
    "",
    "# WebDX Baseline Explorer",
    "",
    `- **Total Web Features**: ${summary.total}`,
    `- **Widely Available**: ${summary.high}`,
    `- **Newly Available**: ${summary.low}`,
    `- **Limited Availability**: ${summary.limited}`,
    "",
    "## Top Feature Groups",
    "",
    mdTable(
      ["Group", "Total", "Widely", "Newly", "Limited", "Widely %", "Median TTA"],
      summary.byGroup.slice(0, 20).map((g) => [
        g.groupName,
        g.total,
        g.high,
        g.low,
        g.limited,
        `${g.widelyPct}%`,
        formatDays(g.medianTtaDays),
      ]),
    ),
    "",
    `## Features Sample (${Math.min(features.length, 30)} of ${features.length})`,
    "",
    mdTable(
      ["ID", "Name", "Group", "Baseline", "Newly Available"],
      features.slice(0, 30).map((f) => [
        `\`${f.id}\``,
        f.name,
        f.groupName,
        f.baseline === "high" ? "Widely" : f.baseline === "low" ? "Newly" : "Limited",
        f.baselineLowDate ?? "—",
      ]),
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export function featureToMarkdown(
  lookup: FeatureLookupResult,
  browsers: readonly BrowserMeta[],
  manifest: Manifest,
  canonicalUrl: string,
): string {
  if (lookup.kind === "web-feature" && lookup.webFeature) {
    const wf = lookup.webFeature;
    const timeline = Object.entries(wf.s)
      .map(([b, s]) => ({ b, ...s }))
      .sort((a, b) => a.d - b.d);
    const lines = [
      "---",
      `id: "${wf.id}"`,
      `kind: "web-feature"`,
      `canonical: "${canonicalUrl}"`,
      `baseline: "${wf.baseline === false ? "limited" : wf.baseline}"`,
      `bcd_version: "${manifest.bcdVersion}"`,
      `web_features_version: "${manifest.webFeaturesVersion}"`,
      "---",
      "",
      `# ${wf.name} (\`${wf.id}\`)`,
      "",
      wf.description,
      "",
      `- **Group**: ${wf.groupName}`,
      `- **Baseline**: ${wf.baseline === "high" ? "Widely Available" : wf.baseline === "low" ? "Newly Available" : "Limited Availability"}`,
      ...(wf.baselineLowDate ? [`- **Newly Available Date**: ${wf.baselineLowDate}`] : []),
      ...(wf.baselineHighDate ? [`- **Widely Available Date**: ${wf.baselineHighDate}`] : []),
      ...(wf.spec ? [`- **Specification**: ${wf.spec}`] : []),
      `- **Constituent BCD keys**: ${wf.compatCount}`,
      "",
      "## Browser Support Timeline",
      "",
      mdTable(
        ["Browser", "Version", "Release Date"],
        timeline.map((t) => [
          browserName(t.b, browsers),
          `${t.le ? "≤" : ""}${t.v}`,
          epochDayToIso(t.d),
        ]),
      ),
      "",
    ];
    return `${lines.join("\n")}\n`;
  }

  const bcd = lookup.bcdFeature!;
  const timeline = Object.entries(bcd.s)
    .filter(([, s]) => s.v && s.d !== undefined)
    .map(([b, s]) => ({ b, v: s.v!, d: s.d!, le: s.le }))
    .sort((a, b) => a.d - b.d);
  const mdnUrl = expandMdnUrl(bcd.mdn);
  const lines = [
    "---",
    `id: "${bcd.id}"`,
    `kind: "bcd"`,
    `category: "${bcd.cat}"`,
    `canonical: "${canonicalUrl}"`,
    `bcd_version: "${manifest.bcdVersion}"`,
    "---",
    "",
    `# \`${bcd.id}\``,
    "",
    `- **Category**: ${CATEGORY_LABELS[bcd.cat]}`,
    ...(bcd.wf ? [`- **Web Feature**: [${bcd.wf}](/feature/${bcd.wf})`] : []),
    ...(mdnUrl ? [`- **MDN**: ${mdnUrl}`] : []),
    ...(bcd.spec ? [`- **Specification**: ${bcd.spec}`] : []),
    "",
    "## Browser Support Timeline",
    "",
    mdTable(
      ["Browser", "Version", "Release Date"],
      timeline.map((t) => [
        browserName(t.b, browsers),
        `${t.le ? "≤" : ""}${t.v}`,
        epochDayToIso(t.d),
      ]),
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
