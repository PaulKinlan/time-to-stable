import { formatDays, formatPct } from "../analysis/support.ts";
import { jsonResponse } from "../formats/json.ts";
import { markdownResponse } from "../formats/markdown.ts";
import type { RouteContext } from "./shared.ts";

export function handleLlmsTxt(ctx: RouteContext): Response {
  const { manifest, origin } = ctx;
  const body = `# Time to Stable

> Live empirical analysis of how long web platform features take to ship across browsers, built on MDN Browser Compat Data (v${manifest.bcdVersion}) and W3C WebDX web-features (v${manifest.webFeaturesVersion}).

## Content Negotiation & Formats
Every HTML page supports clean Markdown and JSON representations:
- Send \`Accept: text/markdown\` header OR append \`?type=md\` for token-efficient Markdown.
- Send \`Accept: application/json\` header OR append \`?type=json\` for structured JSON.
- Append \`?type=csv\` on comparison views for RFC-4180 CSV exports.
- Append \`?type=rss\` on \`/when-stable\` and \`/baseline\` for RSS 2.0 feeds.

## Primary Endpoints
- [Home / Default Comparison](${origin}/): Chrome, Firefox & Safari across DOM API, CSS, HTML, JS
- [Full Data Briefing](${origin}/llms-full.txt): Pre-computed platform metrics, Kaplan-Meier survival rates, and all 7 stories
- [OpenAPI 3.1 Specification](${origin}/openapi.json): Machine-readable API schema
- [Data Stories Hub](${origin}/stories): Seven empirical studies of web platform convergence
- [Baseline Explorer](${origin}/baseline): W3C WebDX Baseline Widely/Newly/Limited breakdown (${manifest.webFeatureCount} features)

## Clean Comparison URLs
- \`${origin}/compare/chrome-vs-safari\`
- \`${origin}/compare/chrome-vs-firefox\`
- \`${origin}/compare/firefox-vs-safari\`
- \`${origin}/compare/chrome-vs-firefox-vs-safari\`
- \`${origin}/compare/chrome-edge-firefox-safari\`
- \`${origin}/compare/baseline-core-7\`
- Append \`/{category}\` (\`api\`, \`css\`, \`html\`, \`http\`, \`javascript\`, \`webassembly\`), \`/not-stable\`, or \`/when-stable\`.
- Single feature lookup: \`${origin}/feature/{web-feature-id-or-bcd-key}\` (e.g. \`/feature/subgrid\`, \`/feature/api.Navigator.clipboard\`).

## JSON API Endpoints
- \`GET ${origin}/api/meta\` — Current BCD/web-features versions, R2/bundled source, and release history
- \`GET ${origin}/api/compare?browsers=chrome,firefox,safari&categories=css,api&mode=web-features\` — Full statistical summary + survival curves
- \`GET ${origin}/api/stats?browser-chrome=on&browser-safari=on&feature-css=on\` — Full statistical breakdown
- \`GET ${origin}/api/features?browsers=chrome,safari&q=grid&sort=days&dir=desc\` — Searchable, sortable, paginated feature rows
- \`GET ${origin}/api/feature/{id}\` — Single Web Feature or BCD key release timeline
- \`GET ${origin}/api/stories\` & \`GET ${origin}/api/stories/{slug}\` — Pre-computed editorial data stories

## Statistical Methodology
1. **Right-Censoring Aware**: Naive yearly averages understate recent-year wait times because slow features have not yet finished converging. Time to Stable reports cohort completion rates and computes **Kaplan–Meier survival probabilities** (1y, 2y, 5y) incorporating still-waiting features.
2. **Median & Quantiles**: Time-to-stable distributions are heavily right-skewed; we report median, IQR, p90, and fast-follow share (≤30d) alongside mean.
3. **Dual Granularity**: Compare either granular \`bcd\` spec keys (${Object.values(manifest.counts).reduce((a, b) => a + b, 0).toLocaleString("en-US")} keys) or user-facing \`web-features\` (${manifest.webFeatureCount} features).
`;
  return markdownResponse(body);
}

export async function handleLlmsFullTxt(ctx: RouteContext): Promise<Response> {
  const pre = await ctx.store.getPrecomputed();
  const { manifest, origin } = ctx;
  const defaultPreset = pre.presets["chrome-vs-firefox-vs-safari:bcd"];
  const wfPreset = pre.presets["chrome-vs-firefox-vs-safari:web-features"];

  const lines: string[] = [
    `# Time to Stable — Complete Live Briefing`,
    "",
    `- **Canonical Origin**: ${origin}`,
    `- **MDN BCD Version**: ${manifest.bcdVersion} (${manifest.bcdTimestamp})`,
    `- **W3C web-features Version**: ${manifest.webFeaturesVersion}`,
    `- **Data Source**: ${ctx.dataSource}`,
    "",
    "## Core 3 Desktop Snapshot (Chrome, Firefox, Safari)",
    "",
  ];

  if (wfPreset) {
    lines.push(
      `### High-Level Web Features (web-features)`,
      `- Landed: ${wfPreset.summary.totalLanded} | Stable: ${wfPreset.summary.stableCount} (${formatPct(wfPreset.summary.completionRate)}) | Waiting: ${wfPreset.summary.waitingCount}`,
      `- Median TTA: ${formatDays(wfPreset.summary.distribution.median)} | IQR: ${formatDays(wfPreset.summary.distribution.iqr)} | p90: ${formatDays(wfPreset.summary.distribution.p90)} | Mean: ${formatDays(wfPreset.summary.distribution.mean)}`,
      `- Kaplan–Meier Convergence: 1y = ${formatPct(wfPreset.summary.survival.probStableBy.d365, false)}, 2y = ${formatPct(wfPreset.summary.survival.probStableBy.d730, false)}`,
      "",
    );
  }

  if (defaultPreset) {
    lines.push(
      `### Granular BCD Keys (DOM API, CSS, HTML, JS)`,
      `- Landed: ${defaultPreset.summary.totalLanded.toLocaleString("en-US")} | Stable: ${defaultPreset.summary.stableCount.toLocaleString("en-US")} (${formatPct(defaultPreset.summary.completionRate)}) | Waiting: ${defaultPreset.summary.waitingCount.toLocaleString("en-US")}`,
      `- Median TTA: ${formatDays(defaultPreset.summary.distribution.median)} | IQR: ${formatDays(defaultPreset.summary.distribution.iqr)} | p90: ${formatDays(defaultPreset.summary.distribution.p90)} | Mean: ${formatDays(defaultPreset.summary.distribution.mean)}`,
      `- Kaplan–Meier Convergence: 1y = ${formatPct(defaultPreset.summary.survival.probStableBy.d365, false)}, 2y = ${formatPct(defaultPreset.summary.survival.probStableBy.d730, false)}`,
      "",
    );
  }

  lines.push(
    "## WebDX Baseline Summary",
    "",
    `- Total Web Features: ${pre.baselineSummary.total}`,
    `- Widely Available: ${pre.baselineSummary.high}`,
    `- Newly Available: ${pre.baselineSummary.low}`,
    `- Limited Availability: ${pre.baselineSummary.limited}`,
    `- Graduating to Widely Available in next 6 months: ${pre.baselineSummary.approachingWidelyAvailable.length}`,
    "",
    "## Editorial Data Stories",
    "",
  );

  for (const s of pre.stories) {
    lines.push(`### ${s.title} (${origin}/stories/${s.slug})`, "", s.summary, "");
    for (const t of s.keyTakeaways) {
      lines.push(`- ${t}`);
    }
    lines.push("");
  }

  return markdownResponse(`${lines.join("\n")}\n`);
}

export function handleOpenApiJson(ctx: RouteContext): Response {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Time to Stable API",
      version: "2.0.0",
      description:
        "Programmatic API for measuring cross-browser web platform stability velocity, Kaplan-Meier survival estimates, Baseline momentum, and individual feature timelines.",
      contact: {
        name: "Paul Kinlan",
        url: "https://paul.kinlan.me/",
      },
    },
    servers: [{ url: ctx.origin }],
    paths: {
      "/api/meta": {
        get: {
          operationId: "getMetadata",
          summary: "Get active BCD and web-features versions, data source, sync status, and release history.",
          responses: {
            "200": { description: "Dataset metadata and snapshot history" },
          },
        },
      },
      "/api/compare": {
        get: {
          operationId: "compareBrowsers",
          summary: "Compare cross-browser time-to-stable statistics across browsers and specification categories.",
          parameters: [
            {
              name: "browsers",
              in: "query",
              description: "Comma-separated browser IDs (e.g. chrome,firefox,safari)",
              schema: { type: "string", default: "chrome,firefox,safari" },
            },
            {
              name: "categories",
              in: "query",
              description: "Comma-separated categories: api,css,html,http,javascript,webassembly",
              schema: { type: "string", default: "api,css,html,javascript" },
            },
            {
              name: "mode",
              in: "query",
              schema: { type: "string", enum: ["bcd", "web-features"], default: "bcd" },
            },
            {
              name: "exclude-partial",
              in: "query",
              schema: { type: "string", enum: ["on"] },
            },
            {
              name: "include-prefixed",
              in: "query",
              schema: { type: "string", enum: ["on"] },
            },
            {
              name: "include-flagged",
              in: "query",
              schema: { type: "string", enum: ["on"] },
            },
            {
              name: "since",
              in: "query",
              description: "Minimum first-landing year filter",
              schema: { type: "integer" },
            },
          ],
          responses: {
            "200": { description: "Statistical summary, survival curve, cross-tab, and top sample rows" },
            "400": { description: "Invalid browser or category selection" },
          },
        },
      },
      "/api/stats": {
        get: {
          operationId: "getStats",
          summary: "Compute full statistical summary using either browser-*/feature-* or comma-separated query parameters.",
          responses: {
            "200": { description: "Full AnalysisSummary JSON" },
            "400": { description: "Invalid parameters" },
          },
        },
      },
      "/api/features": {
        get: {
          operationId: "listFeatures",
          summary: "Search, filter, sort, and paginate evaluated web features or BCD keys.",
          parameters: [
            { name: "view", in: "query", schema: { type: "string", enum: ["stable", "not-stable", "when-stable", "experimental", "deprecated", "removed", "all"] } },
            { name: "browsers", in: "query", schema: { type: "string" } },
            { name: "categories", in: "query", schema: { type: "string" } },
            { name: "mode", in: "query", schema: { type: "string", enum: ["bcd", "web-features"] } },
            { name: "q", in: "query", schema: { type: "string" } },
            { name: "cat", in: "query", schema: { type: "string" } },
            { name: "baseline", in: "query", schema: { type: "string", enum: ["high", "low", "limited"] } },
            { name: "sort", in: "query", schema: { type: "string", enum: ["api", "days", "limbo", "firstDate", "lastDate"] } },
            { name: "dir", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "pageSize", in: "query", schema: { type: "integer", default: 25 } },
          ],
          responses: {
            "200": { description: "Paginated feature evaluations" },
          },
        },
      },
      "/api/feature/{id}": {
        get: {
          operationId: "lookupFeature",
          summary: "Look up browser support timeline and Baseline status by Web Feature ID or MDN BCD key.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Feature details and browser timeline" },
            "404": { description: "Feature not found" },
          },
        },
      },
      "/api/stories": {
        get: {
          operationId: "listStories",
          summary: "List all seven pre-computed empirical web platform data stories.",
          responses: {
            "200": { description: "Story list with metrics and takeaways" },
          },
        },
      },
      "/api/stories/{slug}": {
        get: {
          operationId: "getStory",
          summary: "Retrieve full charts, metrics, takeaways, and tables for a specific story.",
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Full story payload" },
            "404": { description: "Story not found" },
          },
        },
      },
    },
  };
  return jsonResponse(spec);
}
