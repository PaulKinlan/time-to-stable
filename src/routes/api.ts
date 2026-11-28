import { CATEGORY_LABELS, parseQuery } from "../analysis/query.ts";
import { computeAnalysisSummary, computeDistribution } from "../analysis/stats.ts";
import { toRowSnapshot } from "../analysis/support.ts";
import { jsonResponse } from "../formats/json.ts";
import {
  filterAndSortSnapshots,
  loadEvaluations,
  tryGetPrecomputedPreset,
  type RouteContext,
} from "./shared.ts";
import type { CompactFeatureRowSnapshot, FeatureEvaluation } from "../types.ts";

export async function handleApiRoute(
  ctx: RouteContext,
  subPath: string,
): Promise<Response | null> {
  if (subPath === "/api/meta") {
    const history = await ctx.store.getHistory();
    const publicSyncStatus = ctx.syncStatus
      ? {
          checkedAt: ctx.syncStatus.checkedAt,
          currentBcdVersion: ctx.syncStatus.currentBcdVersion,
          currentWebFeaturesVersion: ctx.syncStatus.currentWebFeaturesVersion,
          latestBcdVersion: ctx.syncStatus.latestBcdVersion,
          latestWebFeaturesVersion: ctx.syncStatus.latestWebFeaturesVersion,
          updateAvailable: ctx.syncStatus.updateAvailable,
          ...(ctx.syncStatus.lastUpdatedAt
            ? { lastUpdatedAt: ctx.syncStatus.lastUpdatedAt }
            : {}),
          ...(ctx.syncStatus.actionTriggered
            ? { actionTriggered: ctx.syncStatus.actionTriggered }
            : {}),
          ...(ctx.syncStatus.error ? { hasError: true } : {}),
        }
      : null;
    return jsonResponse(
      {
        manifest: ctx.manifest,
        dataSource: ctx.dataSource,
        syncStatus: publicSyncStatus,
        browsers: ctx.browsers,
        history,
      },
      200,
      { "cache-control": "public, max-age=30, s-maxage=60" },
    );
  }

  if (subPath === "/api/stories") {
    const pre = await ctx.store.getPrecomputed();
    return jsonResponse({
      meta: {
        bcdVersion: ctx.manifest.bcdVersion,
        webFeaturesVersion: ctx.manifest.webFeaturesVersion,
      },
      stories: pre.stories.map((s) => ({
        slug: s.slug,
        title: s.title,
        subtitle: s.subtitle,
        categoryTag: s.categoryTag,
        summary: s.summary,
        keyTakeaways: s.keyTakeaways,
        metrics: s.metrics,
        url: `${ctx.origin}/stories/${s.slug}`,
      })),
    });
  }

  if (subPath.startsWith("/api/stories/")) {
    const slug = decodeURIComponent(subPath.slice("/api/stories/".length));
    const pre = await ctx.store.getPrecomputed();
    const story = pre.stories.find((s) => s.slug === slug);
    if (!story) {
      return jsonResponse({ error: `Unknown story: ${slug}` }, 404);
    }
    return jsonResponse({
      meta: {
        bcdVersion: ctx.manifest.bcdVersion,
        webFeaturesVersion: ctx.manifest.webFeaturesVersion,
      },
      story,
    });
  }

  if (subPath.startsWith("/api/feature/")) {
    const id = subPath.slice("/api/feature/".length);
    const lookup = await ctx.store.lookupFeature(id);
    if (!lookup) {
      return jsonResponse({ error: `Feature not found: ${id}` }, 404);
    }
    return jsonResponse({
      meta: {
        bcdVersion: ctx.manifest.bcdVersion,
        webFeaturesVersion: ctx.manifest.webFeaturesVersion,
      },
      ...lookup,
    });
  }

  if (subPath === "/api/stats" || subPath === "/api/compare") {
    const validIds = ctx.browsers.map((b) => b.id);
    const query = parseQuery(ctx.request, validIds);
    if (query.warnings.length > 0) {
      return jsonResponse(
        { error: "Invalid query parameters", warnings: query.warnings },
        400,
      );
    }

    const preset = await tryGetPrecomputedPreset(ctx, query);
    if (preset) {
      return jsonResponse({
        meta: {
          bcdVersion: ctx.manifest.bcdVersion,
          webFeaturesVersion: ctx.manifest.webFeaturesVersion,
          dataSource: ctx.dataSource,
          precomputed: true,
          browsers: query.browsers,
          categories: query.categories,
          mode: query.mode,
        },
        summary: preset.summary,
        sampleRows: preset.topRows,
      });
    }

    const evals = await loadEvaluations(ctx, query);
    const summary = computeAnalysisSummary(
      evals,
      query.browsers,
      query.categories,
    );
    const sampleRows = evals
      .filter((e) => e.isStable)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, 25)
      .map(toRowSnapshot);

    return jsonResponse({
      meta: {
        bcdVersion: ctx.manifest.bcdVersion,
        webFeaturesVersion: ctx.manifest.webFeaturesVersion,
        dataSource: ctx.dataSource,
        precomputed: false,
        browsers: query.browsers,
        categories: query.categories,
        mode: query.mode,
      },
      summary,
      sampleRows,
    });
  }

  if (subPath === "/api/features") {
    const validIds = ctx.browsers.map((b) => b.id);
    const query = parseQuery(ctx.request, validIds);
    if (query.warnings.length > 0) {
      return jsonResponse(
        { error: "Invalid query parameters", warnings: query.warnings },
        400,
      );
    }

    const view = ctx.url.searchParams.get("view") || "stable";
    const evals = await loadEvaluations(ctx, query);
    let predicate: (ev: FeatureEvaluation) => boolean = (ev) => ev.isStable;
    if (view === "not-stable") {
      predicate = (ev) => !ev.isStable && ev.first !== null;
    } else if (view === "experimental") {
      predicate = (ev) => ev.status.experimental && ev.first !== null;
    } else if (view === "deprecated") {
      predicate = (ev) => ev.status.deprecated && ev.first !== null;
    } else if (view === "removed") {
      predicate = (ev) => ev.removed?.isRemoved === true;
    } else if (view === "all") {
      predicate = () => true;
    }

    const matched = evals.filter(predicate);
    const snapshots: CompactFeatureRowSnapshot[] =
      view === "removed"
        ? matched.map((ev) => ({
            ...toRowSnapshot(ev),
            first: ev.removed!.first,
            last: ev.removed!.last,
            ageInDays: ev.removed!.ageInDays,
          }))
        : matched.map(toRowSnapshot);

    const { allFiltered, pagedRows, totalFiltered } = filterAndSortSnapshots(
      snapshots,
      query,
    );

    const metricVals = allFiltered
      .map((r) => (view === "not-stable" ? r.limboDays : r.ageInDays))
      .filter((v): v is number => v !== null);
    const filteredStats = computeDistribution(metricVals);

    const browserShortNames: Record<string, string> = {};
    const browserNames: Record<string, string> = {};
    for (const b of ctx.browsers) {
      browserShortNames[b.id] = b.shortName;
      browserNames[b.id] = b.name;
    }

    return jsonResponse({
      meta: {
        bcdVersion: ctx.manifest.bcdVersion,
        webFeaturesVersion: ctx.manifest.webFeaturesVersion,
        view,
        mode: query.mode,
      },
      filters: {
        first: query.filterFirst,
        last: query.filterLast,
        has: query.filterHas,
        missing: query.filterMissing,
      },
      filteredStats,
      browserShortNames,
      browserNames,
      categoryLabels: CATEGORY_LABELS,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: totalFiltered,
        totalPages: Math.max(1, Math.ceil(totalFiltered / query.pageSize)),
      },
      rows: pagedRows,
    });
  }

  return null;
}
