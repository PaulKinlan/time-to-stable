import { CATEGORIES, DEFAULT_CATEGORIES } from "../analysis/query.ts";
import { computeAnalysisSummary } from "../analysis/stats.ts";
import { computeAllStories, computeBaselineSummary } from "../analysis/stories.ts";
import {
  DEFAULT_SUPPORT_OPTIONS,
  evaluateFeatureSupport,
  evaluateWebFeatureSupport,
  isoToEpochDay,
  MDN_BASE_URL,
  toRowSnapshot,
} from "../analysis/support.ts";
import type {
  BaselineTier,
  BrowserEngine,
  BrowserMeta,
  BrowserType,
  CategoryShardMeta,
  CategorySlug,
  CaveatTuple,
  CompactBrowserSupport,
  CompactFeature,
  CompactNote,
  CompactWebFeature,
  CompactWebFeatureSupport,
  HistorySnapshot,
  Manifest,
  PrecomputedData,
  PrecomputedPreset,
} from "../types.ts";

export interface RawRelease {
  release_date?: string;
  status?: string;
}

export interface RawBrowser {
  name: string;
  type: BrowserType;
  upstream?: string;
  releases: Record<string, RawRelease>;
}

export interface RawSupportStatement {
  version_added?: string | boolean | null;
  version_removed?: string | boolean | null;
  flags?: unknown[];
  prefix?: string;
  alternative_name?: string;
  partial_implementation?: boolean;
  notes?: string | string[];
}

export interface RawCompat {
  mdn_url?: string;
  spec_url?: string | string[];
  status?: {
    experimental?: boolean;
    standard_track?: boolean;
    deprecated?: boolean;
  };
  support?: Record<string, RawSupportStatement | RawSupportStatement[] | "mirror">;
}

export interface RawWebFeature {
  kind?: string;
  name?: string;
  description?: string;
  description_html?: string;
  group?: string | string[];
  spec?: string | string[];
  compat_features?: string[];
  status?: {
    baseline?: BaselineTier;
    baseline_low_date?: string;
    baseline_high_date?: string;
    support?: Record<string, string>;
  };
}

export interface RawWebFeaturesBundle {
  features: Record<string, RawWebFeature>;
  groups?: Record<string, { name: string; parent?: string }>;
}

export interface RawBcdMeta {
  version: string;
  timestamp: string;
}

const CORE_BROWSERS = new Set([
  "chrome",
  "chrome_android",
  "edge",
  "firefox",
  "firefox_android",
  "safari",
  "safari_ios",
]);

const SHORT_NAMES: Record<string, string> = {
  chrome: "Chrome",
  chrome_android: "Chr And",
  edge: "Edge",
  firefox: "Firefox",
  firefox_android: "FF And",
  safari: "Safari",
  safari_ios: "Saf iOS",
  webview_android: "WV And",
  webview_ios: "WV iOS",
  opera: "Opera",
  opera_android: "Op And",
  samsunginternet_android: "Samsung",
  ie: "IE",
  deno: "Deno",
  nodejs: "Node",
  bun: "Bun",
  oculus: "Quest",
};

const BROWSER_ORDER = [
  "chrome",
  "firefox",
  "safari",
  "edge",
  "chrome_android",
  "firefox_android",
  "safari_ios",
  "webview_android",
  "webview_ios",
  "samsunginternet_android",
  "opera",
  "opera_android",
  "deno",
  "nodejs",
  "bun",
  "oculus",
  "ie",
];

const MAX_SHARD_BYTES = 2_200_000;
const MAX_SHARD_ITEMS = 3500;

function inferEngine(id: string): BrowserEngine {
  if (id === "firefox" || id === "firefox_android") return "gecko";
  if (id === "safari" || id === "safari_ios" || id === "webview_ios") return "webkit";
  if (id === "ie") return "trident";
  if (id === "deno" || id === "nodejs" || id === "bun") return "server";
  return "blink";
}

export function getOrderedBrowserIds(rawBrowsers: Record<string, RawBrowser>): string[] {
  return [
    ...BROWSER_ORDER.filter((id) => id in rawBrowsers),
    ...Object.keys(rawBrowsers).filter((id) => !BROWSER_ORDER.includes(id)),
  ];
}

export function compileBrowsersMeta(
  rawBrowsers: Record<string, RawBrowser>,
): BrowserMeta[] {
  const orderedIds = getOrderedBrowserIds(rawBrowsers);
  return orderedIds.map((id) => {
    const rb = rawBrowsers[id];
    let latestVersion: string | undefined;
    let latestReleaseDate: string | undefined;
    for (const [ver, rel] of Object.entries(rb.releases || {})) {
      if (rel?.release_date && (rel.status === "current" || !latestReleaseDate)) {
        if (!latestReleaseDate || rel.release_date > latestReleaseDate) {
          latestReleaseDate = rel.release_date;
          latestVersion = ver;
        }
      }
    }
    return {
      id,
      name: rb.name,
      shortName: SHORT_NAMES[id] ?? rb.name,
      type: rb.type,
      engine: inferEngine(id),
      upstream: rb.upstream,
      isCore: CORE_BROWSERS.has(id),
      latestVersion,
      latestReleaseDate,
    };
  });
}

function resolveReleaseDay(
  rawVersion: string | boolean | null | undefined,
  browserId: string,
  browsers: Record<string, RawBrowser>,
): { version: string; day: number; approx: boolean } | null {
  if (
    rawVersion === undefined ||
    rawVersion === null ||
    rawVersion === false ||
    rawVersion === "preview"
  ) {
    return null;
  }

  if (rawVersion === "mirror") {
    return null;
  }

  const browserObj = browsers[browserId];
  if (!browserObj) return null;

  if (rawVersion === true) {
    for (const [ver, rel] of Object.entries(browserObj.releases)) {
      if (rel?.release_date) {
        return {
          version: ver,
          day: isoToEpochDay(rel.release_date),
          approx: true,
        };
      }
    }
    return null;
  }

  if (typeof rawVersion !== "string") return null;
  const approx = rawVersion.startsWith("≤");
  const clean = approx ? rawVersion.slice(1) : rawVersion;
  const rel = browserObj.releases[clean];
  if (!rel?.release_date) return null;

  return {
    version: clean,
    day: isoToEpochDay(rel.release_date),
    approx,
  };
}

function resolveBrowserEntry(
  rawStmt: RawSupportStatement | RawSupportStatement[] | "mirror" | undefined,
  browserId: string,
  browsers: Record<string, RawBrowser>,
): { support: CompactBrowserSupport; notes: string[] } | null {
  if (!rawStmt || rawStmt === "mirror") return null;

  const entries = Array.isArray(rawStmt) ? rawStmt : [rawStmt];
  const notesSet = new Set<string>();

  let bestClean: { version: string; day: number; approx: boolean } | null = null;
  let bestPartial: { version: string; day: number; approx: boolean } | null = null;
  let bestPrefixed: { version: string; day: number; approx: boolean } | null = null;
  let bestFlagged: { version: string; day: number; approx: boolean } | null = null;
  let latestRemoved: { version: string; day: number } | null = null;
  let hasActiveUnremoved = false;

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;

    if (entry.notes) {
      const list = Array.isArray(entry.notes) ? entry.notes : [entry.notes];
      for (const n of list) {
        if (typeof n === "string" && n.trim()) notesSet.add(n.trim());
      }
    }

    const removed = resolveReleaseDay(entry.version_removed, browserId, browsers);
    if (removed) {
      if (!latestRemoved || removed.day > latestRemoved.day) {
        latestRemoved = { version: removed.version, day: removed.day };
      }
      continue;
    }

    const added = resolveReleaseDay(entry.version_added, browserId, browsers);
    if (!added) continue;

    hasActiveUnremoved = true;
    const isFlagged = Boolean(entry.flags && entry.flags.length > 0);
    const isPrefixed = Boolean(entry.prefix || entry.alternative_name);
    const isPartial = Boolean(entry.partial_implementation);

    if (!isFlagged && !isPrefixed && !isPartial) {
      if (!bestClean || added.day < bestClean.day) bestClean = added;
    } else if (isFlagged) {
      if (!bestFlagged || added.day < bestFlagged.day) bestFlagged = added;
    } else if (isPrefixed) {
      if (!bestPrefixed || added.day < bestPrefixed.day) bestPrefixed = added;
    } else if (isPartial) {
      if (!bestPartial || added.day < bestPartial.day) bestPartial = added;
    }
  }

  const support: CompactBrowserSupport = {};
  let hasData = false;

  if (bestClean) {
    support.v = bestClean.version;
    support.d = bestClean.day;
    if (bestClean.approx) support.le = 1;
    hasData = true;
  } else {
    if (bestPartial) {
      const tup: CaveatTuple = bestPartial.approx
        ? [bestPartial.version, bestPartial.day, 1]
        : [bestPartial.version, bestPartial.day];
      support.p = tup;
      hasData = true;
    }
    if (bestPrefixed) {
      const tup: CaveatTuple = bestPrefixed.approx
        ? [bestPrefixed.version, bestPrefixed.day, 1]
        : [bestPrefixed.version, bestPrefixed.day];
      support.x = tup;
      hasData = true;
    }
    if (bestFlagged) {
      const tup: CaveatTuple = bestFlagged.approx
        ? [bestFlagged.version, bestFlagged.day, 1]
        : [bestFlagged.version, bestFlagged.day];
      support.f = tup;
      hasData = true;
    }
  }

  if (!hasActiveUnremoved && latestRemoved) {
    support.rv = latestRemoved.version;
    support.rd = latestRemoved.day;
    hasData = true;
  }

  const notes = [...notesSet];
  if (!hasData && notes.length === 0) return null;
  return { support, notes };
}

function buildCompactNotes(
  notesByBrowser: Map<string, string[]>,
): CompactNote[] | undefined {
  if (notesByBrowser.size === 0) return undefined;
  const textToBrowsers = new Map<string, string[]>();
  for (const [browser, notes] of notesByBrowser.entries()) {
    for (const text of notes) {
      let arr = textToBrowsers.get(text);
      if (!arr) {
        arr = [];
        textToBrowsers.set(text, arr);
      }
      if (!arr.includes(browser)) arr.push(browser);
    }
  }
  const out: CompactNote[] = [];
  for (const [t, b] of textToBrowsers.entries()) {
    out.push({ t, b });
  }
  return out.length > 0 ? out : undefined;
}

function stripMdnPrefix(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith(MDN_BASE_URL)) {
    return url.slice(MDN_BASE_URL.length);
  }
  return url;
}

function firstSpecUrl(spec?: string | string[]): string | undefined {
  if (!spec) return undefined;
  if (Array.isArray(spec)) return spec[0];
  return spec;
}

export function compileWebFeatures(
  wfData: RawWebFeaturesBundle,
  rawBrowsers: Record<string, RawBrowser>,
): {
  webFeatures: CompactWebFeature[];
  bcdToWf: Map<string, CompactWebFeature>;
} {
  const webFeatures: CompactWebFeature[] = [];
  const bcdToWf = new Map<string, CompactWebFeature>();
  const validCatSet = new Set<string>(CATEGORIES);

  for (const [id, raw] of Object.entries(wfData.features || {})) {
    if (raw.kind && raw.kind !== "feature") continue;
    const compatKeys = raw.compat_features ?? [];
    const catSet = new Set<CategorySlug>();
    for (const ck of compatKeys) {
      const top = ck.split(".")[0];
      if (validCatSet.has(top)) catSet.add(top as CategorySlug);
    }
    const groupId = Array.isArray(raw.group)
      ? raw.group[0] ?? "other"
      : raw.group ?? "other";
    const groupName = wfData.groups?.[groupId]?.name ?? groupId;
    const baseline: BaselineTier = raw.status?.baseline ?? false;
    const baselineLowDate = raw.status?.baseline_low_date;
    const baselineLowDay = baselineLowDate
      ? isoToEpochDay(baselineLowDate)
      : undefined;
    const baselineHighDate = raw.status?.baseline_high_date;

    const supportMap: Record<string, CompactWebFeatureSupport> = {};
    for (const [b, ver] of Object.entries(raw.status?.support ?? {})) {
      const resolved = resolveReleaseDay(ver, b, rawBrowsers);
      if (resolved) {
        supportMap[b] = {
          v: resolved.version,
          d: resolved.day,
          ...(resolved.approx ? { le: 1 as const } : {}),
        };
      }
    }

    const wfEntry: CompactWebFeature = {
      id,
      name: raw.name ?? id,
      description: raw.description ?? "",
      group: groupId,
      groupName,
      spec: firstSpecUrl(raw.spec),
      baseline,
      ...(baselineLowDate ? { baselineLowDate } : {}),
      ...(baselineLowDay !== undefined ? { baselineLowDay } : {}),
      ...(baselineHighDate ? { baselineHighDate } : {}),
      compatCount: compatKeys.length,
      cats: catSet.size > 0 ? [...catSet] : ["api"],
      compatKeysSample: compatKeys.slice(0, 25),
      s: supportMap,
    };

    webFeatures.push(wfEntry);
    for (const ck of compatKeys) {
      if (!bcdToWf.has(ck)) bcdToWf.set(ck, wfEntry);
    }
  }

  webFeatures.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { webFeatures, bcdToWf };
}

export function extractCompactFeaturesFromNode(
  node: unknown,
  basePath: string,
  cat: CategorySlug,
  orderedIds: readonly string[],
  rawBrowsers: Record<string, RawBrowser>,
  bcdToWf: ReadonlyMap<string, CompactWebFeature>,
): CompactFeature[] {
  const out: CompactFeature[] = [];

  function walk(curr: unknown, currentPath: string) {
    if (!curr || typeof curr !== "object") return;
    const rec = curr as Record<string, unknown>;
    if ("__compat" in rec && rec.__compat && typeof rec.__compat === "object") {
      const compat = rec.__compat as RawCompat;
      const st =
        (compat.status?.standard_track ? 1 : 0) |
        (compat.status?.experimental ? 2 : 0) |
        (compat.status?.deprecated ? 4 : 0);

      const s: Record<string, CompactBrowserSupport> = {};
      const notesByBrowser = new Map<string, string[]>();

      for (const browserId of orderedIds) {
        const rawStmt = compat.support?.[browserId];
        const resolved = resolveBrowserEntry(rawStmt, browserId, rawBrowsers);
        if (!resolved) continue;
        if (Object.keys(resolved.support).length > 0) {
          s[browserId] = resolved.support;
        }
        if (resolved.notes.length > 0) {
          notesByBrowser.set(browserId, resolved.notes);
        }
      }

      const linkedWf = bcdToWf.get(currentPath);
      const notes = buildCompactNotes(notesByBrowser);
      const mdn = stripMdnPrefix(compat.mdn_url);
      const spec = firstSpecUrl(compat.spec_url);

      out.push({
        id: currentPath,
        cat,
        ...(mdn ? { mdn } : {}),
        ...(spec ? { spec } : {}),
        st,
        ...(linkedWf
          ? {
              wf: linkedWf.id,
              bl: linkedWf.baseline,
              ...(linkedWf.baselineLowDay !== undefined
                ? { bld: linkedWf.baselineLowDay }
                : {}),
            }
          : {}),
        s,
        ...(notes ? { notes } : {}),
      });
    }

    for (const [key, value] of Object.entries(rec)) {
      if (key.startsWith("__")) continue;
      walk(value, currentPath ? `${currentPath}.${key}` : key);
    }
  }

  walk(node, basePath);
  return out;
}

export function shardCategoryFeatures(
  cat: CategorySlug,
  catFeatures: CompactFeature[],
): {
  shardsMeta: CategoryShardMeta[];
  shardPayloads: Array<{ file: string; json: string }>;
} {
  // Deterministic ASCII/UTF-16 codepoint sort so binary/range shard lookup is exact
  catFeatures.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const serializedWhole = JSON.stringify(catFeatures);
  const shardsMeta: CategoryShardMeta[] = [];
  const shardPayloads: Array<{ file: string; json: string }> = [];

  if (
    serializedWhole.length <= MAX_SHARD_BYTES &&
    catFeatures.length <= MAX_SHARD_ITEMS
  ) {
    const file = `cat-${cat}.json`;
    shardPayloads.push({ file, json: serializedWhole });
    shardsMeta.push({
      file,
      count: catFeatures.length,
      firstId: catFeatures[0]?.id ?? "",
      lastId: catFeatures[catFeatures.length - 1]?.id ?? "",
    });
  } else {
    const parts = Math.max(
      Math.ceil(serializedWhole.length / MAX_SHARD_BYTES),
      Math.ceil(catFeatures.length / MAX_SHARD_ITEMS),
    );
    const chunkSize = Math.ceil(catFeatures.length / parts);
    for (let i = 0; i < parts; i++) {
      const slice = catFeatures.slice(i * chunkSize, (i + 1) * chunkSize);
      if (slice.length === 0) continue;
      const file = `cat-${cat}-${i}.json`;
      shardPayloads.push({ file, json: JSON.stringify(slice) });
      shardsMeta.push({
        file,
        count: slice.length,
        firstId: slice[0].id,
        lastId: slice[slice.length - 1].id,
      });
    }
  }

  return { shardsMeta, shardPayloads };
}

export function buildPrecomputedAndManifest(opts: {
  bcdMeta: RawBcdMeta;
  webFeaturesVersion: string;
  browsersMeta: BrowserMeta[];
  allBcdFeatures: CompactFeature[];
  webFeatures: CompactWebFeature[];
  counts: Record<CategorySlug, number>;
  categoryShards: Record<CategorySlug, CategoryShardMeta[]>;
  shardFiles: string[];
  existingHistory?: HistorySnapshot[];
}): {
  manifest: Manifest;
  precomputed: PrecomputedData;
  historySnapshot: HistorySnapshot;
  historySeed: HistorySnapshot[];
} {
  const {
    bcdMeta,
    webFeaturesVersion,
    browsersMeta,
    allBcdFeatures,
    webFeatures,
    counts,
    categoryShards,
    shardFiles,
    existingHistory,
  } = opts;

  const bcdVersion = bcdMeta.version;
  const bcdTimestamp = bcdMeta.timestamp;
  const bcdEpochDay = isoToEpochDay(bcdTimestamp);

  const files = [
    "browsers.json",
    "web-features.json",
    "history-seed.json",
    "precomputed.json",
    ...shardFiles,
    "manifest.json",
  ];

  const manifest: Manifest = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    bcdVersion,
    bcdTimestamp,
    bcdEpochDay,
    webFeaturesVersion,
    counts,
    categoryShards,
    files,
    webFeatureCount: webFeatures.length,
    categories: [...CATEGORIES],
  };

  const core3Bcd = allBcdFeatures
    .filter((f) => DEFAULT_CATEGORIES.includes(f.cat))
    .map((f) =>
      evaluateFeatureSupport(
        f,
        ["chrome", "firefox", "safari"],
        DEFAULT_SUPPORT_OPTIONS,
        bcdEpochDay,
      ),
    );
  const core3Summary = computeAnalysisSummary(
    core3Bcd,
    ["chrome", "firefox", "safari"],
    [...DEFAULT_CATEGORIES],
  );
  const baselineSummary = computeBaselineSummary(webFeatures, manifest);

  const historySnapshot: HistorySnapshot = {
    date: bcdTimestamp.slice(0, 10),
    bcdVersion,
    webFeaturesVersion,
    bcdTotal: allBcdFeatures.length,
    core3StableBcd: core3Summary.stableCount,
    core3NotStableBcd: core3Summary.waitingCount,
    core3MedianTtaDaysBcd: core3Summary.distribution.median,
    webFeaturesTotal: webFeatures.length,
    baselineHigh: baselineSummary.high,
    baselineLow: baselineSummary.low,
    baselineLimited: baselineSummary.limited,
  };

  const historyForStories = existingHistory && existingHistory.length > 0
    ? [
        ...existingHistory.filter(
          (h) =>
            !(
              h.bcdVersion === historySnapshot.bcdVersion &&
              h.webFeaturesVersion === historySnapshot.webFeaturesVersion
            ),
        ),
        historySnapshot,
      ]
    : [historySnapshot];

  const stories = computeAllStories(
    allBcdFeatures,
    webFeatures,
    browsersMeta,
    manifest,
    historyForStories,
  );

  const presetDefs: Array<{ slug: string; browsers: string[] }> = [
    { slug: "chrome-vs-firefox-vs-safari", browsers: ["chrome", "firefox", "safari"] },
    { slug: "chrome-vs-safari", browsers: ["chrome", "safari"] },
    { slug: "chrome-vs-firefox", browsers: ["chrome", "firefox"] },
    { slug: "firefox-vs-safari", browsers: ["firefox", "safari"] },
    { slug: "chrome-edge-firefox-safari", browsers: ["chrome", "edge", "firefox", "safari"] },
    {
      slug: "baseline-core-7",
      browsers: [
        "chrome",
        "chrome_android",
        "edge",
        "firefox",
        "firefox_android",
        "safari",
        "safari_ios",
      ],
    },
  ];

  const defaultCatsBcd = allBcdFeatures.filter((f) =>
    DEFAULT_CATEGORIES.includes(f.cat),
  );
  const defaultCatsWf = webFeatures.filter((wf) =>
    wf.cats.some((c) => DEFAULT_CATEGORIES.includes(c)),
  );

  const presets: Record<string, PrecomputedPreset> = {};
  for (const def of presetDefs) {
    const bcdEvals = defaultCatsBcd.map((f) =>
      evaluateFeatureSupport(
        f,
        def.browsers,
        DEFAULT_SUPPORT_OPTIONS,
        bcdEpochDay,
      ),
    );
    const bcdSummary = computeAnalysisSummary(
      bcdEvals,
      def.browsers,
      [...DEFAULT_CATEGORIES],
    );
    const bcdStableSorted = bcdEvals
      .filter((e) => e.isStable)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    presets[`${def.slug}:bcd`] = {
      slug: def.slug,
      mode: "bcd",
      browsers: def.browsers,
      categories: [...DEFAULT_CATEGORIES],
      summary: bcdSummary,
      topRows: bcdStableSorted.slice(0, 25).map(toRowSnapshot),
      totalRows: bcdStableSorted.length,
    };

    const wfEvals = defaultCatsWf.map((wf) =>
      evaluateWebFeatureSupport(wf, def.browsers, bcdEpochDay),
    );
    const wfSummary = computeAnalysisSummary(
      wfEvals,
      def.browsers,
      [...DEFAULT_CATEGORIES],
    );
    const wfStableSorted = wfEvals
      .filter((e) => e.isStable)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    presets[`${def.slug}:web-features`] = {
      slug: def.slug,
      mode: "web-features",
      browsers: def.browsers,
      categories: [...DEFAULT_CATEGORIES],
      summary: wfSummary,
      topRows: wfStableSorted.slice(0, 25).map(toRowSnapshot),
      totalRows: wfStableSorted.length,
    };
  }

  const precomputed: PrecomputedData = {
    generatedAt: manifest.generatedAt,
    bcdVersion,
    webFeaturesVersion,
    presets,
    stories,
    baselineSummary,
  };

  return {
    manifest,
    precomputed,
    historySnapshot,
    historySeed: [historySnapshot],
  };
}
