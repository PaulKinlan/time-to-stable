import {
  BROWSER_PRESETS,
  buildSelectionParams,
  CATEGORIES,
  CATEGORY_LABELS,
} from "../analysis/query.ts";
import { escapeHtml } from "../formats/html.ts";
import type { BrowserMeta, ParsedQuery } from "../types.ts";

export interface ControlsOptions {
  actionPath: string;
  browsers: readonly BrowserMeta[];
  query: ParsedQuery;
  canonicalUrl: string;
  showModeToggle?: boolean;
  showStrictness?: boolean;
  showSinceYear?: boolean;
  showExportCsv?: boolean;
  showExportRss?: boolean;
}

export function renderControls(opts: ControlsOptions): string {
  const {
    actionPath,
    browsers,
    query,
    canonicalUrl,
    showModeToggle = true,
    showStrictness = true,
    showSinceYear = true,
    showExportCsv = true,
    showExportRss = false,
  } = opts;

  const selectedBrowsers = new Set(query.browsers);
  const selectedCats = new Set(query.categories);

  const coreBrowsers = browsers.filter((b) => b.isCore);
  const secondaryBrowsers = browsers.filter((b) => !b.isCore);
  const anySecondarySelected = secondaryBrowsers.some((b) =>
    selectedBrowsers.has(b.id),
  );

  const renderBrowserPill = (b: BrowserMeta) => {
    const checked = selectedBrowsers.has(b.id) ? " checked" : "";
    return `<label class="pill-check"><input type="checkbox" name="browser-${escapeHtml(b.id)}" value="on"${checked}><span>${escapeHtml(b.name)}</span></label>`;
  };

  const renderCategoryPill = (cat: (typeof CATEGORIES)[number]) => {
    const checked = selectedCats.has(cat) ? " checked" : "";
    return `<label class="pill-check"><input type="checkbox" name="feature-${escapeHtml(cat)}" value="on"${checked}><span>${escapeHtml(CATEGORY_LABELS[cat])}</span></label>`;
  };

  const presetsHtml = BROWSER_PRESETS.slice(0, 6)
    .map(
      (p) =>
        `<button type="button" class="chip-btn" data-preset-browsers="${escapeHtml(p.browsers.join(","))}" title="${escapeHtml(p.description)}">${escapeHtml(p.label)}</button>`,
    )
    .join("");

  const warningsHtml =
    query.warnings.length > 0
      ? `<div class="warnings" role="alert"><ul>${query.warnings
          .map((w) => `<li>${escapeHtml(w)}</li>`)
          .join("")}</ul></div>`
      : "";

  const baseQs = buildSelectionParams(query);
  const csvHref = `${actionPath}?${baseQs ? `${baseQs}&` : ""}type=csv`;
  const jsonHref = `${actionPath}?${baseQs ? `${baseQs}&` : ""}type=json`;
  const mdHref = `${actionPath}?${baseQs ? `${baseQs}&` : ""}type=md`;
  const rssHref = `${actionPath}?${baseQs ? `${baseQs}&` : ""}type=rss`;

  const sinceYears = [2015, 2018, 2020, 2022, 2024];

  return `<section class="control-panel" aria-label="Comparison Filters">
  ${warningsHtml}
  <div class="preset-row">
    <span class="preset-label">Presets:</span>
    ${presetsHtml}
  </div>
  <form id="compare-form" method="GET" action="${escapeHtml(actionPath)}">
    <input type="hidden" name="submitted" value="1">
    <div class="control-grid">
      <fieldset class="pill-group">
        <legend>Browsers (pick 2 or more)</legend>
        <div class="pill-list">
          ${coreBrowsers.map(renderBrowserPill).join("")}
        </div>
        <details class="more-browsers"${anySecondarySelected ? " open" : ""}>
          <summary>More browsers &amp; runtimes (${secondaryBrowsers.length})</summary>
          <div class="pill-list">
            ${secondaryBrowsers.map(renderBrowserPill).join("")}
          </div>
        </details>
      </fieldset>

      <fieldset class="pill-group">
        <legend>Feature Areas</legend>
        <div class="pill-list">
          ${CATEGORIES.map(renderCategoryPill).join("")}
          <button type="button" class="chip-btn" data-cat-action="all">All</button>
          <button type="button" class="chip-btn" data-cat-action="clear">Clear</button>
        </div>
      </fieldset>
    </div>

    ${
      showModeToggle || showStrictness || showSinceYear
        ? `<div class="options-bar">
      <div class="options-group">
        ${
          showModeToggle
            ? `<label>Granularity
          <select name="mode">
            <option value="bcd"${query.mode === "bcd" ? " selected" : ""}>BCD Keys (granular)</option>
            <option value="web-features"${query.mode === "web-features" ? " selected" : ""}>Web Features (Baseline)</option>
          </select>
        </label>`
            : ""
        }
        ${
          showSinceYear
            ? `<label>First landed since
          <select name="since">
            <option value="">All years</option>
            ${sinceYears
              .map(
                (y) =>
                  `<option value="${y}"${query.sinceYear === y ? " selected" : ""}>${y}+</option>`,
              )
              .join("")}
          </select>
        </label>`
            : ""
        }
      </div>
      ${
        showStrictness
          ? `<div class="options-group">
        <label><input type="checkbox" name="exclude-partial" value="on"${query.excludePartial ? " checked" : ""}> Exclude partial</label>
        <label><input type="checkbox" name="include-prefixed" value="on"${query.includePrefixed ? " checked" : ""}> Include prefixed</label>
        <label><input type="checkbox" name="include-flagged" value="on"${query.includeFlagged ? " checked" : ""}> Include flagged</label>
      </div>`
          : ""
      }
    </div>`
        : ""
    }

    <div class="action-bar">
      <div class="export-links">
        <button type="submit" class="btn btn-primary">Compare</button>
        <a class="btn" href="${escapeHtml(actionPath)}">Reset</a>
      </div>
      <div class="export-links">
        ${showExportCsv ? `<a class="btn" href="${escapeHtml(csvHref)}">CSV</a>` : ""}
        <a class="btn" href="${escapeHtml(jsonHref)}">JSON</a>
        <a class="btn" href="${escapeHtml(mdHref)}">Markdown</a>
        ${showExportRss ? `<a class="btn" href="${escapeHtml(rssHref)}">RSS</a>` : ""}
        <button type="button" class="btn" id="copy-link-btn" data-copy-url="${escapeHtml(canonicalUrl)}">Copy Link</button>
      </div>
    </div>
  </form>
</section>`;
}
