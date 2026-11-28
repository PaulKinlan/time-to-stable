import { buildSelectionParams, CATEGORIES, CATEGORY_LABELS } from "../analysis/query.ts";
import { computeDistribution } from "../analysis/stats.ts";
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
  SortField,
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

export interface MatrixLinkConfig {
  kind: "first-last" | "has-missing";
  actionPath: string;
  query: ParsedQuery;
}

interface DrillAnchorOpts {
  first?: string;
  last?: string;
  has?: string;
  missing?: string;
  sort?: SortField;
  dir?: "asc" | "desc";
  clearBrowserFilter?: boolean;
}

function buildDrillHref(
  actionPath: string,
  query: ParsedQuery,
  opts: DrillAnchorOpts,
): string {
  const qs = buildSelectionParams(query, {
    q: query.search,
    cat: query.filterCategory,
    baseline: query.filterBaseline,
    first: opts.first ?? "",
    last: opts.last ?? "",
    has: opts.has ?? "",
    missing: opts.missing ?? "",
    sort: opts.sort ?? query.sort,
    dir: opts.dir ?? query.dir,
  });
  return `${actionPath}?${qs}#raw-explorer`;
}

function buildDrillDataAttrs(opts: DrillAnchorOpts): string {
  return [
    'data-drill-filter="1"',
    `data-first="${escapeHtml(opts.first ?? "")}"`,
    `data-last="${escapeHtml(opts.last ?? "")}"`,
    `data-has="${escapeHtml(opts.has ?? "")}"`,
    `data-missing="${escapeHtml(opts.missing ?? "")}"`,
    `data-sort="${escapeHtml(opts.sort ?? "days")}"`,
    `data-dir="${escapeHtml(opts.dir ?? "desc")}"`,
    opts.clearBrowserFilter ? 'data-clear-browser-filter="1"' : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function renderCrossTabMatrix(
  crossTab: CrossTabResult,
  browsers: readonly BrowserMeta[],
  caption: string,
  rowPrefix: string,
  colPrefix: string,
  linkConfig?: MatrixLinkConfig,
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

  const sortForKind = linkConfig?.kind === "has-missing" ? "limbo" : "days";

  const bodyRows = crossTab.browsers
    .map((rb) => {
      const cells = crossTab.browsers
        .map((cb) => {
          const val = crossTab.matrix[rb]?.[cb] ?? 0;
          const heat = val > 0 ? Math.max(0.08, val / maxVal) : 0;
          const med = crossTab.medianMatrix?.[rb]?.[cb];
          const medHtml =
            med !== null && med !== undefined
              ? `<span class="cell-sub">med ${escapeHtml(formatDays(med))}</span>`
              : "";

          let cellInner = `${val.toLocaleString("en-US")}${medHtml}`;
          if (linkConfig && val > 0) {
            const opts: DrillAnchorOpts =
              linkConfig.kind === "has-missing"
                ? { has: rb, missing: cb, sort: sortForKind, dir: "desc" }
                : { first: rb, last: cb, sort: sortForKind, dir: "desc" };
            const isActive =
              linkConfig.kind === "has-missing"
                ? linkConfig.query.filterHas === rb &&
                  linkConfig.query.filterMissing === cb
                : linkConfig.query.filterFirst === rb &&
                  linkConfig.query.filterLast === cb;
            const href = buildDrillHref(linkConfig.actionPath, linkConfig.query, opts);
            cellInner = `<a class="matrix-link${isActive ? " matrix-link-active" : ""}" href="${escapeHtml(href)}" ${buildDrillDataAttrs(opts)} title="View these ${val.toLocaleString("en-US")} features in the Feature Explorer">${val.toLocaleString("en-US")}${medHtml}</a>`;
          }
          return `<td class="num heat-cell" style="--heat:${heat.toFixed(2)}">${cellInner}</td>`;
        })
        .join("");
      const rowTotal = crossTab.rowTotals[rb] ?? 0;
      let rowTotalHtml = `<strong>${rowTotal.toLocaleString("en-US")}</strong>`;
      if (linkConfig && rowTotal > 0) {
        const opts: DrillAnchorOpts =
          linkConfig.kind === "has-missing"
            ? { has: rb, sort: sortForKind, dir: "desc" }
            : { first: rb, sort: sortForKind, dir: "desc" };
        const isActive =
          linkConfig.kind === "has-missing"
            ? linkConfig.query.filterHas === rb && !linkConfig.query.filterMissing
            : linkConfig.query.filterFirst === rb && !linkConfig.query.filterLast;
        const href = buildDrillHref(linkConfig.actionPath, linkConfig.query, opts);
        rowTotalHtml = `<a class="matrix-link${isActive ? " matrix-link-active" : ""}" href="${escapeHtml(href)}" ${buildDrillDataAttrs(opts)} title="View all ${rowTotal.toLocaleString("en-US")} features in the Feature Explorer"><strong>${rowTotal.toLocaleString("en-US")}</strong></a>`;
      }
      return `<tr>
        <th scope="row">${escapeHtml(rowPrefix)} ${escapeHtml(browserShort(rb, browsers))}</th>
        ${cells}
        <td class="num">${rowTotalHtml}</td>
      </tr>`;
    })
    .join("");

  const footCells = crossTab.browsers
    .map((cb) => {
      const colTotal = crossTab.colTotals[cb] ?? 0;
      let colHtml = `<strong>${colTotal.toLocaleString("en-US")}</strong>`;
      if (linkConfig && colTotal > 0) {
        const opts: DrillAnchorOpts =
          linkConfig.kind === "has-missing"
            ? { missing: cb, sort: sortForKind, dir: "desc" }
            : { last: cb, sort: sortForKind, dir: "desc" };
        const isActive =
          linkConfig.kind === "has-missing"
            ? linkConfig.query.filterMissing === cb && !linkConfig.query.filterHas
            : linkConfig.query.filterLast === cb && !linkConfig.query.filterFirst;
        const href = buildDrillHref(linkConfig.actionPath, linkConfig.query, opts);
        colHtml = `<a class="matrix-link${isActive ? " matrix-link-active" : ""}" href="${escapeHtml(href)}" ${buildDrillDataAttrs(opts)} title="View all ${colTotal.toLocaleString("en-US")} features in the Feature Explorer"><strong>${colTotal.toLocaleString("en-US")}</strong></a>`;
      }
      return `<td class="num">${colHtml}</td>`;
    })
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

export function renderDirectionalComparisonStrip(
  crossTab: CrossTabResult,
  browsers: readonly BrowserMeta[],
  actionPath: string,
  query: ParsedQuery,
): string {
  const pairs: Array<{
    first: string;
    last: string;
    count: number;
    med: number | null | undefined;
    p90: number | null | undefined;
  }> = [];

  for (const rb of crossTab.browsers) {
    for (const cb of crossTab.browsers) {
      if (rb === cb) continue;
      const count = crossTab.matrix[rb]?.[cb] ?? 0;
      if (count <= 0) continue;
      pairs.push({
        first: rb,
        last: cb,
        count,
        med: crossTab.medianMatrix?.[rb]?.[cb],
        p90: crossTab.p90Matrix?.[rb]?.[cb],
      });
    }
  }

  if (pairs.length === 0) return "";
  pairs.sort((a, b) => b.count - a.count);
  const topPairs = pairs.slice(0, 6);

  const cardsHtml = topPairs
    .map((pair) => {
      const opts: DrillAnchorOpts = {
        first: pair.first,
        last: pair.last,
        sort: "days",
        dir: "desc",
      };
      const isActive =
        query.filterFirst === pair.first && query.filterLast === pair.last;
      const href = buildDrillHref(actionPath, query, opts);
      const metaParts = [`${pair.count.toLocaleString("en-US")} features`];
      if (pair.med !== null && pair.med !== undefined) {
        metaParts.push(`Median ${formatDays(pair.med)}`);
      }
      if (pair.p90 !== null && pair.p90 !== undefined) {
        metaParts.push(`p90 ${formatDays(pair.p90)}`);
      }

      return `<a class="dir-card${isActive ? " dir-card-active" : ""}" href="${escapeHtml(href)}" ${buildDrillDataAttrs(opts)}>
      <div class="dir-card-title">First in ${escapeHtml(browserShort(pair.first, browsers))} → Last in ${escapeHtml(browserShort(pair.last, browsers))}</div>
      <div class="dir-card-meta">${escapeHtml(metaParts.join(" · "))}</div>
      <div class="dir-card-cta">Inspect features ↓</div>
    </a>`;
    })
    .join("");

  return `<div class="dir-strip" role="region" aria-label="Directional browser comparisons">${cardsHtml}</div>`;
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
        <th scope="col"><span title="Mature cohorts have reached at least 80% completion across selected browsers; In progress (right-censored) cohorts are still below 80% completion.">Cohort Status</span></th>
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
        <td>${y.isRightCensored ? '<span class="badge badge-warn" title="Fewer than 80% of this year&#39;s features have shipped in all selected browsers yet. Slower features are still waiting, so raw median days look artificially short.">In progress (right-censored)</span>' : '<span class="badge badge-high" title="At least 80% of this year&#39;s features have shipped across all selected browsers, so its median wait time is stable.">Mature (≥80%)</span>'}</td>
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
  linkConfig?: { actionPath: string; query: ParsedQuery },
): string {
  if (share.length === 0) return "";
  return `<div class="table-wrap">
  <table class="data-table">
    <caption>Overall Sprinter (first to ship) vs. Plodder (last to ship) frequency and median wait time across stable features. Click any count to inspect those features below.</caption>
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
        .map((r) => {
          let firstCell = r.firstCount.toLocaleString("en-US");
          let lastCell = r.lastCount.toLocaleString("en-US");
          if (linkConfig && r.firstCount > 0) {
            const opts: DrillAnchorOpts = { first: r.browser, sort: "days", dir: "desc" };
            const isActive =
              linkConfig.query.filterFirst === r.browser && !linkConfig.query.filterLast;
            const href = buildDrillHref(linkConfig.actionPath, linkConfig.query, opts);
            firstCell = `<a class="matrix-link${isActive ? " matrix-link-active" : ""}" href="${escapeHtml(href)}" ${buildDrillDataAttrs(opts)} title="Inspect features where ${escapeHtml(browserName(r.browser, browsers))} shipped first">${firstCell}</a>`;
          }
          if (linkConfig && r.lastCount > 0) {
            const opts: DrillAnchorOpts = { last: r.browser, sort: "days", dir: "desc" };
            const isActive =
              linkConfig.query.filterLast === r.browser && !linkConfig.query.filterFirst;
            const href = buildDrillHref(linkConfig.actionPath, linkConfig.query, opts);
            lastCell = `<a class="matrix-link${isActive ? " matrix-link-active" : ""}" href="${escapeHtml(href)}" ${buildDrillDataAttrs(opts)} title="Inspect features where ${escapeHtml(browserName(r.browser, browsers))} shipped last">${lastCell}</a>`;
          }
          return `<tr>
        <th scope="row">${escapeHtml(browserName(r.browser, browsers))}</th>
        <td class="num">${firstCell}</td>
        <td class="num">${r.firstPct}%</td>
        <td class="num">${escapeHtml(formatDays(r.firstMedianDays))}</td>
        <td class="num">${lastCell}</td>
        <td class="num">${r.lastPct}%</td>
        <td class="num">${escapeHtml(formatDays(r.lastMedianDays))}</td>
      </tr>`;
        })
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
  allFilteredRows?: readonly CompactFeatureRowSnapshot[];
  totalFilteredRows: number;
  browsers: readonly BrowserMeta[];
}

function renderActiveFilterSummaryHtml(
  opts: ExplorerOptions,
): { hasFilter: boolean; html: string } {
  const { view, actionPath, query, allFilteredRows, totalFilteredRows, browsers } = opts;
  const isNotStable = view === "not-stable";
  const hasFilter = isNotStable
    ? Boolean(query.filterHas || query.filterMissing)
    : Boolean(query.filterFirst || query.filterLast);

  if (!hasFilter) {
    return { hasFilter: false, html: "" };
  }

  let label = "";
  let swapOpts: DrillAnchorOpts | null = null;
  let swapLabel = "";

  if (isNotStable) {
    if (query.filterHas && query.filterMissing) {
      label = `In ${browserName(query.filterHas, browsers)} → Missing in ${browserName(query.filterMissing, browsers)}`;
      if (query.filterHas !== query.filterMissing) {
        swapOpts = {
          has: query.filterMissing,
          missing: query.filterHas,
          sort: "limbo",
          dir: "desc",
        };
        swapLabel = `Compare reverse (${browserShort(query.filterMissing, browsers)} → missing ${browserShort(query.filterHas, browsers)})`;
      }
    } else if (query.filterHas) {
      label = `Already in ${browserName(query.filterHas, browsers)}`;
    } else if (query.filterMissing) {
      label = `Missing in ${browserName(query.filterMissing, browsers)}`;
    }
  } else {
    if (query.filterFirst && query.filterLast) {
      label = `First in ${browserName(query.filterFirst, browsers)} → Last in ${browserName(query.filterLast, browsers)}`;
      if (query.filterFirst !== query.filterLast) {
        swapOpts = {
          first: query.filterLast,
          last: query.filterFirst,
          sort: "days",
          dir: "desc",
        };
        swapLabel = `Compare reverse (${browserShort(query.filterLast, browsers)} → ${browserShort(query.filterFirst, browsers)})`;
      }
    } else if (query.filterFirst) {
      label = `First in ${browserName(query.filterFirst, browsers)}`;
      if (query.browsers.length === 2) {
        const other = query.browsers.find((b) => b !== query.filterFirst);
        if (other) {
          swapOpts = {
            first: other,
            last: query.filterFirst,
            sort: "days",
            dir: "desc",
          };
          swapLabel = `Compare reverse (${browserShort(other, browsers)} → ${browserShort(query.filterFirst, browsers)})`;
        }
      }
    } else if (query.filterLast) {
      label = `Last in ${browserName(query.filterLast, browsers)}`;
      if (query.browsers.length === 2) {
        const other = query.browsers.find((b) => b !== query.filterLast);
        if (other) {
          swapOpts = {
            first: query.filterLast,
            last: other,
            sort: "days",
            dir: "desc",
          };
          swapLabel = `Compare reverse (${browserShort(query.filterLast, browsers)} → ${browserShort(other, browsers)})`;
        }
      }
    }
  }

  const statsSource = allFilteredRows ?? [];
  const metricValues = statsSource
    .map((r) => (isNotStable ? r.limboDays : r.ageInDays))
    .filter((v): v is number => v !== null);
  const dist = computeDistribution(metricValues);

  const statsParts = [`${totalFilteredRows.toLocaleString("en-US")} features`];
  if (dist.count > 0) {
    statsParts.push(`Median ${formatDays(dist.median)}`);
    statsParts.push(`IQR ${formatDays(dist.iqr)}`);
    statsParts.push(`p90 ${formatDays(dist.p90)}`);
    statsParts.push(`Max ${formatDays(dist.max)}`);
  }

  const swapBtn = swapOpts
    ? `<a class="btn" href="${escapeHtml(buildDrillHref(actionPath, query, swapOpts))}" ${buildDrillDataAttrs(swapOpts)}>⇄ ${escapeHtml(swapLabel)}</a>`
    : "";

  const clearOpts: DrillAnchorOpts = {
    sort: query.sort,
    dir: query.dir,
    clearBrowserFilter: true,
  };
  const clearBtn = `<a class="btn" href="${escapeHtml(buildDrillHref(actionPath, query, clearOpts))}" ${buildDrillDataAttrs(clearOpts)}>Clear browser filter</a>`;

  return {
    hasFilter: true,
    html: `<div class="active-filter-meta"><strong>${escapeHtml(label)}</strong> · ${escapeHtml(statsParts.join(" · "))}</div>
    <div class="active-filter-actions">${swapBtn}${clearBtn}</div>`,
  };
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
      first: query.filterFirst,
      last: query.filterLast,
      has: query.filterHas,
      missing: query.filterMissing,
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

  const browserRoleSelects =
    view === "not-stable"
      ? `<label class="sr-only" for="explorer-has">Shipped in browser</label>
      <select id="explorer-has" name="has">
        <option value="">In any selected browser</option>
        ${query.browsers
          .map(
            (b) =>
              `<option value="${escapeHtml(b)}"${query.filterHas === b ? " selected" : ""}>In ${escapeHtml(browserName(b, browsers))}</option>`,
          )
          .join("")}
      </select>
      <label class="sr-only" for="explorer-missing">Missing in browser</label>
      <select id="explorer-missing" name="missing">
        <option value="">Missing in any browser</option>
        ${query.browsers
          .map(
            (b) =>
              `<option value="${escapeHtml(b)}"${query.filterMissing === b ? " selected" : ""}>Missing in ${escapeHtml(browserName(b, browsers))}</option>`,
          )
          .join("")}
      </select>`
      : `<label class="sr-only" for="explorer-first">First browser to ship</label>
      <select id="explorer-first" name="first">
        <option value="">First in: Any</option>
        ${query.browsers
          .map(
            (b) =>
              `<option value="${escapeHtml(b)}"${query.filterFirst === b ? " selected" : ""}>First in ${escapeHtml(browserName(b, browsers))}</option>`,
          )
          .join("")}
      </select>
      <label class="sr-only" for="explorer-last">Last browser to ship</label>
      <select id="explorer-last" name="last">
        <option value="">Last in: Any</option>
        ${query.browsers
          .map(
            (b) =>
              `<option value="${escapeHtml(b)}"${query.filterLast === b ? " selected" : ""}>Last in ${escapeHtml(browserName(b, browsers))}</option>`,
          )
          .join("")}
      </select>`;

  const activeFilter = renderActiveFilterSummaryHtml(opts);

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
      ${browserRoleSelects}
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

  <div id="explorer-active-filter" class="active-filter-bar"${activeFilter.hasFilter ? "" : " hidden"}>${activeFilter.html}</div>

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
