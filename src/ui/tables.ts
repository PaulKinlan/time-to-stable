import { buildSelectionParams, CATEGORIES, CATEGORY_LABELS } from "../analysis/query.ts";
import {
  caveatLabel,
  epochDayToIso,
  formatDays,
  formatPct,
} from "../analysis/support.ts";
import { escapeHtml } from "../formats/html.ts";
import { renderCompactNotes } from "./notes.ts";
import type {
  BaselineTier,
  BrowserMeta,
  BrowserShareRow,
  CategorySummaryRow,
  CompactFeatureRowSnapshot,
  CrossTabResult,
  ParsedQuery,
  ViewKind,
  YearlyCohortRow,
} from "../types.ts";

function browserName(id: string, browsers: readonly BrowserMeta[]): string {
  return browsers.find((b) => b.id === id)?.name ?? id;
}

function browserShort(id: string, browsers: readonly BrowserMeta[]): string {
  return browsers.find((b) => b.id === id)?.shortName ?? id;
}

export function renderKpiGrid(
  items: ReadonlyArray<{ label: string; value: string; detail?: string }>,
): string {
  return `<section class="kpi-grid" aria-label="Summary Metrics">
  ${items
    .map(
      (k) => `<div class="kpi-card">
    <div class="kpi-label">${escapeHtml(k.label)}</div>
    <div class="kpi-value">${escapeHtml(k.value)}</div>
    ${k.detail ? `<div class="kpi-detail">${escapeHtml(k.detail)}</div>` : ""}
  </div>`,
    )
    .join("")}
</section>`;
}

export function renderBaselineBadge(baseline?: BaselineTier): string {
  if (baseline === "high") {
    return '<span class="badge badge-high">Baseline Widely</span>';
  }
  if (baseline === "low") {
    return '<span class="badge badge-low">Baseline Newly</span>';
  }
  return '<span class="badge badge-limited">Limited</span>';
}

export function renderCrossTabMatrix(
  crossTab: CrossTabResult,
  browsers: readonly BrowserMeta[],
  caption: string,
  rowPrefix: string,
  colPrefix: string,
): string {
  let maxVal = 1;
  for (const r of crossTab.browsers) {
    for (const c of crossTab.browsers) {
      const val = crossTab.matrix[r]?.[c] ?? 0;
      if (val > maxVal) maxVal = val;
    }
  }

  const headCells = crossTab.browsers
    .map(
      (b) =>
        `<th class="num" scope="col">${escapeHtml(colPrefix)} ${escapeHtml(browserShort(b, browsers))}</th>`,
    )
    .join("");

  const bodyRows = crossTab.browsers
    .map((rb) => {
      const cells = crossTab.browsers
        .map((cb) => {
          const val = crossTab.matrix[rb]?.[cb] ?? 0;
          const heat = val > 0 ? Math.max(0.08, val / maxVal) : 0;
          return `<td class="num heat-cell" style="--heat:${heat.toFixed(2)}">${val.toLocaleString("en-US")}</td>`;
        })
        .join("");
      const rowTotal = crossTab.rowTotals[rb] ?? 0;
      return `<tr>
        <th scope="row">${escapeHtml(rowPrefix)} ${escapeHtml(browserShort(rb, browsers))}</th>
        ${cells}
        <td class="num"><strong>${rowTotal.toLocaleString("en-US")}</strong></td>
      </tr>`;
    })
    .join("");

  const footCells = crossTab.browsers
    .map(
      (cb) =>
        `<td class="num"><strong>${(crossTab.colTotals[cb] ?? 0).toLocaleString("en-US")}</strong></td>`,
    )
    .join("");

  return `<div class="table-wrap">
  <table class="data-table">
    <caption>${escapeHtml(caption)}</caption>
    <thead>
      <tr>
        <th scope="col">Browser</th>
        ${headCells}
        <th class="num" scope="col">Row Total</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
    <tfoot>
      <tr>
        <th scope="row">Total</th>
        ${footCells}
        <td class="num"><strong>${crossTab.total.toLocaleString("en-US")}</strong></td>
      </tr>
    </tfoot>
  </table>
</div>`;
}

export function renderCategoryBreakdownTable(
  rows: readonly CategorySummaryRow[],
): string {
  if (rows.length === 0) return "";
  return `<div class="table-wrap">
  <table class="data-table">
    <caption>Breakdown by specification category including right-censored features still waiting to converge.</caption>
    <thead>
      <tr>
        <th scope="col">Category</th>
        <th class="num" scope="col">Landed</th>
        <th class="num" scope="col">Stable</th>
        <th class="num" scope="col">Waiting</th>
        <th class="num" scope="col">Complete</th>
        <th class="num" scope="col">1y KM%</th>
        <th class="num" scope="col">Median TTA</th>
        <th class="num" scope="col">p90 TTA</th>
        <th class="num" scope="col">Mean TTA</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (r) => `<tr>
        <th scope="row">${escapeHtml(CATEGORY_LABELS[r.category])}</th>
        <td class="num">${r.totalLanded.toLocaleString("en-US")}</td>
        <td class="num">${r.stableCount.toLocaleString("en-US")}</td>
        <td class="num">${r.waitingCount.toLocaleString("en-US")}</td>
        <td class="num">${escapeHtml(formatPct(r.completionRate))}</td>
        <td class="num">${escapeHtml(formatPct(r.km1yPct, false))}</td>
        <td class="num">${escapeHtml(formatDays(r.medianDays))}</td>
        <td class="num">${escapeHtml(formatDays(r.p90Days))}</td>
        <td class="num">${escapeHtml(formatDays(r.meanDays))}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>
</div>`;
}

export function renderYearlyCohortTable(
  cohorts: readonly YearlyCohortRow[],
): string {
  if (cohorts.length === 0) return "";
  const sortedDesc = [...cohorts].reverse();
  return `<div class="table-wrap below-fold-section">
  <table class="data-table">
    <caption>Yearly cohorts grouped by the year each feature first shipped in any selected browser. Cohorts under 80% completion are flagged as right-censored.</caption>
    <thead>
      <tr>
        <th scope="col">First Year</th>
        <th class="num" scope="col">Landed</th>
        <th class="num" scope="col">Stable</th>
        <th class="num" scope="col">Waiting</th>
        <th class="num" scope="col">Complete</th>
        <th class="num" scope="col">1y KM%</th>
        <th class="num" scope="col">2y KM%</th>
        <th class="num" scope="col">Median TTA</th>
        <th class="num" scope="col">p90 TTA</th>
        <th scope="col">Cohort Status</th>
      </tr>
    </thead>
    <tbody>
      ${sortedDesc
        .map(
          (y) => `<tr${y.isRightCensored ? ' class="censored-row"' : ""}>
        <th scope="row">${y.year}</th>
        <td class="num">${y.totalLanded.toLocaleString("en-US")}</td>
        <td class="num">${y.stableCount.toLocaleString("en-US")}</td>
        <td class="num">${y.waitingCount.toLocaleString("en-US")}</td>
        <td class="num">${escapeHtml(formatPct(y.completionRate))}</td>
        <td class="num">${escapeHtml(formatPct(y.km1yPct, false))}</td>
        <td class="num">${escapeHtml(formatPct(y.km2yPct, false))}</td>
        <td class="num">${escapeHtml(formatDays(y.medianDays))}</td>
        <td class="num">${escapeHtml(formatDays(y.p90Days))}</td>
        <td>${y.isRightCensored ? '<span class="badge badge-warn">Right-censored</span>' : '<span class="badge badge-high">Mature</span>'}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>
</div>`;
}

export function renderSprintersPloddersTables(
  share: readonly BrowserShareRow[],
  browsers: readonly BrowserMeta[],
): string {
  if (share.length === 0) return "";
  return `<div class="table-wrap">
  <table class="data-table">
    <caption>Overall Sprinter (first to ship) vs. Plodder (last to ship) frequency and median wait time across stable features.</caption>
    <thead>
      <tr>
        <th scope="col">Browser</th>
        <th class="num" scope="col">First-In Count</th>
        <th class="num" scope="col">First-In %</th>
        <th class="num" scope="col">First-In Median Wait</th>
        <th class="num" scope="col">Last-In Count</th>
        <th class="num" scope="col">Last-In %</th>
        <th class="num" scope="col">Last-In Median Wait</th>
      </tr>
    </thead>
    <tbody>
      ${share
        .map(
          (r) => `<tr>
        <th scope="row">${escapeHtml(browserName(r.browser, browsers))}</th>
        <td class="num">${r.firstCount.toLocaleString("en-US")}</td>
        <td class="num">${r.firstPct}%</td>
        <td class="num">${escapeHtml(formatDays(r.firstMedianDays))}</td>
        <td class="num">${r.lastCount.toLocaleString("en-US")}</td>
        <td class="num">${r.lastPct}%</td>
        <td class="num">${escapeHtml(formatDays(r.lastMedianDays))}</td>
      </tr>`,
        )
        .join("")}
    </tbody>
  </table>
</div>`;
}

export function renderTimelineChips(
  row: CompactFeatureRowSnapshot,
  browsers: readonly BrowserMeta[],
): string {
  const present = row.browserTimeline
    .map((pt) => {
      const label = browserShort(pt.browser, browsers);
      const cav = pt.caveat ? ` (${caveatLabel(pt.caveat)})` : "";
      const dateStr = epochDayToIso(pt.day);
      return `<span class="b-chip" title="${escapeHtml(`${browserName(pt.browser, browsers)} ${pt.version} on ${dateStr}${cav}`)}">${escapeHtml(label)} ${escapeHtml(pt.approx ? `≤${pt.version}` : pt.version)} · ${escapeHtml(dateStr.slice(0, 7))}${pt.caveat ? ` <span class="badge badge-warn">${escapeHtml(caveatLabel(pt.caveat))}</span>` : ""}</span>`;
    })
    .join("");

  const missing = row.missingBrowsers
    .map(
      (b) =>
        `<span class="b-chip b-chip-missing" title="Missing in ${escapeHtml(browserName(b, browsers))}">− ${escapeHtml(browserShort(b, browsers))}</span>`,
    )
    .join("");

  return `<div class="timeline-chips">${present}${missing}</div>`;
}

export interface ExplorerOptions {
  view: ViewKind;
  actionPath: string;
  query: ParsedQuery;
  rows: readonly CompactFeatureRowSnapshot[];
  totalFilteredRows: number;
  browsers: readonly BrowserMeta[];
}

export function renderRawExplorerSection(opts: ExplorerOptions): string {
  const { view, actionPath, query, rows, totalFilteredRows, browsers } = opts;
  const totalPages = Math.max(1, Math.ceil(totalFilteredRows / query.pageSize));
  const currentPage = Math.min(query.page, totalPages);

  const pageHref = (p: number) => {
    const qs = buildSelectionParams(query, {
      q: query.search,
      cat: query.filterCategory,
      baseline: query.filterBaseline,
      sort: query.sort,
      dir: query.dir,
      page: p,
    });
    return `${actionPath}?${qs}#raw-explorer`;
  };

  const hiddenInputs = [
    ...query.browsers.map(
      (b) => `<input type="hidden" name="browser-${escapeHtml(b)}" value="on">`,
    ),
    ...query.categories.map(
      (c) => `<input type="hidden" name="feature-${escapeHtml(c)}" value="on">`,
    ),
    `<input type="hidden" name="submitted" value="1">`,
    query.mode !== "bcd"
      ? `<input type="hidden" name="mode" value="${escapeHtml(query.mode)}">`
      : "",
    query.excludePartial
      ? `<input type="hidden" name="exclude-partial" value="on">`
      : "",
    query.includePrefixed
      ? `<input type="hidden" name="include-prefixed" value="on">`
      : "",
    query.includeFlagged
      ? `<input type="hidden" name="include-flagged" value="on">`
      : "",
    query.sinceYear !== null
      ? `<input type="hidden" name="since" value="${query.sinceYear}">`
      : "",
  ].join("");

  const sortOptions: Array<{ value: string; label: string }> = [
    { value: "api", label: "Name / API key" },
    { value: "days", label: "Time to Stable (days)" },
    { value: "limbo", label: "Days in Limbo" },
    { value: "firstDate", label: "First Release Date" },
    { value: "lastDate", label: "Last Release Date" },
  ];

  const rowsHtml = rows.length
    ? rows
        .map((r) => {
          const featureHref = `/feature/${encodeURIComponent(r.id)}`;
          const primaryLabel = r.name
            ? `<strong><a href="${escapeHtml(featureHref)}">${escapeHtml(r.name)}</a></strong><br><code class="mono">${escapeHtml(r.id)}</code>`
            : `<a class="mono" href="${escapeHtml(featureHref)}">${escapeHtml(r.id)}</a>`;
          const extLinks = [
            r.mdnUrl
              ? `<a href="${escapeHtml(r.mdnUrl)}" target="_blank" rel="noopener">MDN</a>`
              : "",
            r.specUrl
              ? `<a href="${escapeHtml(r.specUrl)}" target="_blank" rel="noopener">Spec</a>`
              : "",
          ]
            .filter(Boolean)
            .join(" · ");

          const waitCell =
            r.ageInDays !== null
              ? escapeHtml(formatDays(r.ageInDays))
              : r.limboDays !== null
              ? `${escapeHtml(formatDays(r.limboDays))} <span class="badge badge-warn">limbo</span>`
              : "—";

          return `<tr>
        <td>
          ${primaryLabel}
          ${extLinks ? `<div class="feature-notes">${extLinks}</div>` : ""}
          ${renderCompactNotes(r.notes, browsers)}
        </td>
        <td>${escapeHtml(CATEGORY_LABELS[r.cat])}</td>
        <td>${renderBaselineBadge(r.baseline)}</td>
        <td>${renderTimelineChips(r, browsers)}</td>
        <td class="num">${waitCell}</td>
      </tr>`;
        })
        .join("")
    : `<tr><td colspan="5">No matching features for the current filters.</td></tr>`;

  return `<section id="raw-explorer" class="below-fold-section" data-view="${escapeHtml(view)}" data-action-path="${escapeHtml(actionPath)}" data-page-size="${query.pageSize}" aria-labelledby="explorer-heading">
  <h2 id="explorer-heading">Feature Explorer (${totalFilteredRows.toLocaleString("en-US")} matching)</h2>
  <search>
    <form id="explorer-filter-form" class="search-bar" method="GET" action="${escapeHtml(actionPath)}#raw-explorer">
      ${hiddenInputs}
      <label class="sr-only" for="explorer-q">Filter by feature name or BCD key</label>
      <input id="explorer-q" type="search" name="q" value="${escapeHtml(query.search)}" placeholder="Search API or feature (e.g. subgrid, navigator.gpu, popover)...">
      <label class="sr-only" for="explorer-cat">Category</label>
      <select id="explorer-cat" name="cat">
        <option value="">All selected areas</option>
        ${query.categories
          .map(
            (c) =>
              `<option value="${escapeHtml(c)}"${query.filterCategory === c ? " selected" : ""}>${escapeHtml(CATEGORY_LABELS[c])}</option>`,
          )
          .join("")}
      </select>
      <label class="sr-only" for="explorer-baseline">Baseline status</label>
      <select id="explorer-baseline" name="baseline">
        <option value="">All Baseline tiers</option>
        <option value="high"${query.filterBaseline === "high" ? " selected" : ""}>Widely Available</option>
        <option value="low"${query.filterBaseline === "low" ? " selected" : ""}>Newly Available</option>
        <option value="limited"${query.filterBaseline === "limited" ? " selected" : ""}>Limited</option>
      </select>
      <label class="sr-only" for="explorer-sort">Sort by</label>
      <select id="explorer-sort" name="sort">
        ${sortOptions
          .map(
            (s) =>
              `<option value="${escapeHtml(s.value)}"${query.sort === s.value ? " selected" : ""}>Sort: ${escapeHtml(s.label)}</option>`,
          )
          .join("")}
      </select>
      <label class="sr-only" for="explorer-dir">Sort direction</label>
      <select id="explorer-dir" name="dir">
        <option value="asc"${query.dir === "asc" ? " selected" : ""}>Asc</option>
        <option value="desc"${query.dir === "desc" ? " selected" : ""}>Desc</option>
      </select>
      <button type="submit" class="btn">Filter</button>
    </form>
  </search>

  <div class="pagination" id="explorer-pagination-top">
    <span id="explorer-status">Showing page ${currentPage} of ${totalPages} (${totalFilteredRows.toLocaleString("en-US")} features)</span>
    <div class="pagination-controls">
      ${currentPage > 1 ? `<a class="btn" data-page="${currentPage - 1}" href="${escapeHtml(pageHref(currentPage - 1))}">Previous</a>` : '<span class="btn" aria-disabled="true">Previous</span>'}
      ${currentPage < totalPages ? `<a class="btn" data-page="${currentPage + 1}" href="${escapeHtml(pageHref(currentPage + 1))}">Next</a>` : '<span class="btn" aria-disabled="true">Next</span>'}
    </div>
  </div>

  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th scope="col">Feature / API Key</th>
          <th scope="col">Area</th>
          <th scope="col">Baseline</th>
          <th scope="col">Browser Launch Timeline</th>
          <th class="num" scope="col">Wait / Span</th>
        </tr>
      </thead>
      <tbody id="explorer-tbody">
        ${rowsHtml}
      </tbody>
    </table>
  </div>
</section>`;
}
