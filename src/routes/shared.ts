import { DEFAULT_CATEGORIES } from "../analysis/query.ts";
import { computeAnalysisSummary } from "../analysis/stats.ts";
import {
  epochDayToYear,
  evaluateFeatureSupport,
  evaluateWebFeatureSupport,
  toRowSnapshot,
} from "../analysis/support.ts";
import { DataStore } from "../data/store.ts";
import { csvResponse, buildFeatureRowsCsv } from "../formats/csv.ts";
import { htmlResponse } from "../formats/html.ts";
import { jsonResponse } from "../formats/json.ts";
import {
  markdownResponse,
  renderAnalysisMarkdown,
} from "../formats/markdown.ts";
import type {
  AnalysisSummary,
  BrowserMeta,
  CompactFeatureRowSnapshot,
  Env,
  FeatureEvaluation,
  Manifest,
  ParsedQuery,
  PrecomputedPreset,
  SyncStatus,
  ViewKind,
} from "../types.ts";

export interface RouteContext {
  request: Request;
  url: URL;
  origin: string;
  env: Env;
  store: DataStore;
  manifest: Manifest;
  dataSource: "r2" | "bundled";
  browsers: BrowserMeta[];
  syncStatus: SyncStatus | null;
  timings: Array<[string, number]>;
}

export async function createRouteContext(
  request: Request,
  env: Env,
): Promise<RouteContext> {
  const url = new URL(request.url);
  const canonicalHost = env.CANONICAL_HOST?.trim();
  const origin = canonicalHost
    ? `https://${canonicalHost}`
    : `${url.protocol}//${url.host}`;

  const t0 = performance.now();
  const store = new DataStore(env);
  const [{ manifest, source }, browsers, syncStatus] = await Promise.all([
    store.getManifestWithSource(),
    store.getBrowsers(),
    store.getSyncStatus(),
  ]);
  const t1 = performance.now();

  return {
    request,
    url,
    origin,
    env,
    store,
    manifest,
    dataSource: source,
    browsers,
    syncStatus,
    timings: [["store", Math.round((t1 - t0) * 10) / 10]],
  };
}

export function formatBrowserList(
  ids: readonly string[],
  browsers: readonly BrowserMeta[],
): string {
  const names = ids.map(
    (id) => browsers.find((b) => b.id === id)?.name ?? id,
  );
  if (names.length === 0) return "";
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(
    names,
  );
}

const DEFAULT_CAT_KEY = [...DEFAULT_CATEGORIES].sort().join(",");

export function getPresetKey(query: ParsedQuery): string | null {
  if (!query.presetSlug) return null;
  if (query.excludePartial || query.includePrefixed || query.includeFlagged) {
    return null;
  }
  if (query.sinceYear !== null) return null;
  const catsKey = [...query.categories].sort().join(",");
  if (catsKey !== DEFAULT_CAT_KEY) return null;
  return `${query.presetSlug}:${query.mode}`;
}

export function canServeFastPresetRows(
  query: ParsedQuery,
  view: ViewKind,
): boolean {
  return (
    view === "stable" &&
    query.format === "html" &&
    !query.search &&
    !query.filterCategory &&
    !query.filterBaseline &&
    !query.filterFirst &&
    !query.filterLast &&
    !query.filterHas &&
    !query.filterMissing &&
    query.sort === "api" &&
    query.dir === "asc" &&
    query.page === 1 &&
    query.pageSize <= 25
  );
}

export async function tryGetPrecomputedPreset(
  ctx: RouteContext,
  query: ParsedQuery,
): Promise<PrecomputedPreset | null> {
  const key = getPresetKey(query);
  if (!key) return null;
  const pre = await ctx.store.getPrecomputed();
  return pre.presets[key] ?? null;
}

export async function loadEvaluations(
  ctx: RouteContext,
  query: ParsedQuery,
): Promise<FeatureEvaluation[]> {
  const t0 = performance.now();
  const refDay = ctx.manifest.bcdEpochDay;
  const opts = {
    excludePartial: query.excludePartial,
    includePrefixed: query.includePrefixed,
    includeFlagged: query.includeFlagged,
  };

  let evals: FeatureEvaluation[];

  if (query.mode === "web-features") {
    const wf = await ctx.store.getWebFeatures();
    const selectedCats = new Set(query.categories);
    const filtered = wf.filter((item) =>
      item.cats.some((c) => selectedCats.has(c)),
    );
    evals = filtered.map((item) =>
      evaluateWebFeatureSupport(item, query.browsers, refDay),
    );
  } else {
    const bcdFeatures = await ctx.store.getCategoriesFeatures(query.categories);
    evals = bcdFeatures.map((item) =>
      evaluateFeatureSupport(item, query.browsers, opts, refDay),
    );
  }

  if (query.sinceYear !== null) {
    const minYear = query.sinceYear;
    evals = evals.filter(
      (ev) => ev.first !== null && epochDayToYear(ev.first.day) >= minYear,
    );
  }

  ctx.timings.push(["eval", Math.round((performance.now() - t0) * 10) / 10]);
  return evals;
}

export function filterAndSortSnapshots(
  rows: readonly CompactFeatureRowSnapshot[],
  query: ParsedQuery,
): {
  allFiltered: CompactFeatureRowSnapshot[];
  pagedRows: CompactFeatureRowSnapshot[];
  totalFiltered: number;
} {
  const qLower = query.search.toLowerCase();
  const filtered = rows.filter((r) => {
    if (query.filterCategory && r.cat !== query.filterCategory) return false;
    if (query.filterBaseline) {
      if (query.filterBaseline === "limited" && r.baseline !== false && r.baseline !== undefined) {
        return false;
      }
      if (
        (query.filterBaseline === "high" || query.filterBaseline === "low") &&
        r.baseline !== query.filterBaseline
      ) {
        return false;
      }
    }
    if (query.filterFirst && r.first?.browser !== query.filterFirst) return false;
    if (query.filterLast && r.last?.browser !== query.filterLast) return false;
    if (
      query.filterHas &&
      !r.browserTimeline.some((pt) => pt.browser === query.filterHas)
    ) {
      return false;
    }
    if (
      query.filterMissing &&
      !r.missingBrowsers.includes(query.filterMissing)
    ) {
      return false;
    }
    if (qLower) {
      const idMatch = r.id.toLowerCase().includes(qLower);
      const nameMatch = r.name ? r.name.toLowerCase().includes(qLower) : false;
      if (!idMatch && !nameMatch) return false;
    }
    return true;
  });

  const dirMul = query.dir === "desc" ? -1 : 1;
  const sorted = [...filtered].sort((a, b) => {
    if (query.sort === "days") {
      const av = a.ageInDays ?? a.limboDays ?? -1;
      const bv = b.ageInDays ?? b.limboDays ?? -1;
      return (av - bv) * dirMul || (a.id < b.id ? -1 : 1);
    }
    if (query.sort === "limbo") {
      const av = a.limboDays ?? a.ageInDays ?? -1;
      const bv = b.limboDays ?? b.ageInDays ?? -1;
      return (av - bv) * dirMul || (a.id < b.id ? -1 : 1);
    }
    if (query.sort === "firstDate") {
      const av = a.first?.day ?? -99999;
      const bv = b.first?.day ?? -99999;
      return (av - bv) * dirMul || (a.id < b.id ? -1 : 1);
    }
    if (query.sort === "lastDate") {
      const av = a.last?.day ?? -99999;
      const bv = b.last?.day ?? -99999;
      return (av - bv) * dirMul || (a.id < b.id ? -1 : 1);
    }
    if (a.id === b.id) return 0;
    return (a.id < b.id ? -1 : 1) * dirMul;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const start = (page - 1) * query.pageSize;
  const pagedRows = sorted.slice(start, start + query.pageSize);

  return {
    allFiltered: sorted,
    pagedRows,
    totalFiltered: sorted.length,
  };
}

export function buildExportOrErrorResponse(opts: {
  view: ViewKind;
  ctx: RouteContext;
  query: ParsedQuery;
  title: string;
  description: string;
  canonicalUrl: string;
  summary?: AnalysisSummary;
  allRows: readonly CompactFeatureRowSnapshot[];
  pagedRows: readonly CompactFeatureRowSnapshot[];
  totalFiltered: number;
}): Response | null {
  const {
    view,
    ctx,
    query,
    title,
    description,
    canonicalUrl,
    summary,
    allRows,
    pagedRows,
    totalFiltered,
  } = opts;

  if (query.warnings.length > 0 && query.format !== "html") {
    return jsonResponse(
      { error: "Invalid query parameters", warnings: query.warnings },
      400,
    );
  }

  if (query.format === "csv") {
    const csv = buildFeatureRowsCsv(view, allRows, ctx.browsers, query.browsers);
    return csvResponse(csv.filename, csv.headers, csv.csvRows);
  }

  if (query.format === "json") {
    return jsonResponse({
      meta: {
        title,
        description,
        canonicalUrl,
        bcdVersion: ctx.manifest.bcdVersion,
        bcdTimestamp: ctx.manifest.bcdTimestamp,
        webFeaturesVersion: ctx.manifest.webFeaturesVersion,
        dataSource: ctx.dataSource,
        query: {
          view,
          mode: query.mode,
          browsers: query.browsers,
          categories: query.categories,
          excludePartial: query.excludePartial,
          includePrefixed: query.includePrefixed,
          includeFlagged: query.includeFlagged,
          sinceYear: query.sinceYear,
          ...(query.filterFirst ? { first: query.filterFirst } : {}),
          ...(query.filterLast ? { last: query.filterLast } : {}),
          ...(query.filterHas ? { has: query.filterHas } : {}),
          ...(query.filterMissing ? { missing: query.filterMissing } : {}),
          page: query.page,
          pageSize: query.pageSize,
        },
      },
      summary: summary ?? null,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: totalFiltered,
        totalPages: Math.max(1, Math.ceil(totalFiltered / query.pageSize)),
      },
      rows: pagedRows,
    });
  }

  if (query.format === "md") {
    const md = renderAnalysisMarkdown({
      title,
      description,
      canonicalUrl,
      manifest: ctx.manifest,
      query,
      browsers: ctx.browsers,
      summary,
      rows: pagedRows,
      totalRows: totalFiltered,
    });
    return markdownResponse(md);
  }

  return null;
}

export async function resolveSummaryAndRows(
  ctx: RouteContext,
  query: ParsedQuery,
  view: "stable" | "not-stable" | "when-stable" | "all",
  filterFn: (ev: FeatureEvaluation) => boolean,
): Promise<{
  summary: AnalysisSummary;
  allRows: CompactFeatureRowSnapshot[];
  pagedRows: CompactFeatureRowSnapshot[];
  totalFiltered: number;
}> {
  const preset = await tryGetPrecomputedPreset(ctx, query);
  if (preset && canServeFastPresetRows(query, view)) {
    return {
      summary: preset.summary,
      allRows: preset.topRows,
      pagedRows: preset.topRows.slice(0, query.pageSize),
      totalFiltered: preset.totalRows,
    };
  }

  const evals = await loadEvaluations(ctx, query);
  const summary = preset
    ? preset.summary
    : computeAnalysisSummary(evals, query.browsers, query.categories);
  const matchingSnapshots = evals.filter(filterFn).map(toRowSnapshot);
  const { allFiltered, pagedRows, totalFiltered } = filterAndSortSnapshots(
    matchingSnapshots,
    query,
  );

  return {
    summary,
    allRows: allFiltered,
    pagedRows,
    totalFiltered,
  };
}

export function buildDatasetSchema(opts: {
  origin: string;
  canonicalUrl: string;
  name: string;
  description: string;
  manifest: Manifest;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}): unknown[] {
  const schemas: unknown[] = [
    {
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: opts.name,
      description: opts.description,
      url: opts.canonicalUrl,
      version: `BCD ${opts.manifest.bcdVersion} / web-features ${opts.manifest.webFeaturesVersion}`,
      dateModified: opts.manifest.bcdTimestamp,
      creator: {
        "@type": "Person",
        name: "Paul Kinlan",
        url: "https://paul.kinlan.me/",
      },
      license: "https://creativecommons.org/publicdomain/zero/1.0/",
      isBasedOn: [
        "https://github.com/mdn/browser-compat-data",
        "https://github.com/web-platform-dx/web-features",
      ],
    },
  ];

  if (opts.breadcrumbs && opts.breadcrumbs.length > 0) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: opts.breadcrumbs.map((b, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: b.label,
        item: b.href ? `${opts.origin}${b.href}` : opts.canonicalUrl,
      })),
    });
  }

  return schemas;
}

export function finishHtml(html: string, status = 200): Response {
  return htmlResponse(html, status);
}
