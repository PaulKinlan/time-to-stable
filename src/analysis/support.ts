import type {
  BrowserPoint,
  CategorySlug,
  CaveatKind,
  CompactBrowserSupport,
  CompactFeature,
  CompactFeatureRowSnapshot,
  CompactWebFeature,
  FeatureEvaluation,
  RemovedStats,
  SupportFilterOptions,
  TimelinePoint,
} from "../types.ts";

export const MS_PER_DAY = 86_400_000;
export const MDN_BASE_URL = "https://developer.mozilla.org/docs/Web/";

export const DEFAULT_SUPPORT_OPTIONS: SupportFilterOptions = {
  excludePartial: false,
  includePrefixed: false,
  includeFlagged: false,
};

export function expandMdnUrl(mdn?: string): string | undefined {
  if (!mdn) return undefined;
  if (mdn.startsWith("http://") || mdn.startsWith("https://")) return mdn;
  return `${MDN_BASE_URL}${mdn.replace(/^\/+/, "")}`;
}

export function cleanIsoDate(iso: string): string {
  return iso.replace(/^≤/, "").slice(0, 10);
}

export function isoToEpochDay(iso: string): number {
  const clean = cleanIsoDate(iso);
  const ms = Date.parse(`${clean}T00:00:00Z`);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / MS_PER_DAY);
}

export function epochDayToIso(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function epochDayToYear(day: number): number {
  return new Date(day * MS_PER_DAY).getUTCFullYear();
}

export function epochDayToYearMonth(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 7);
}

export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined || Number.isNaN(days)) return "—";
  const rounded = Math.round(days);
  if (rounded === 0) return "0d";
  if (rounded < 365) return `${rounded.toLocaleString("en-US")}d`;
  const years = rounded / 365.25;
  return `${rounded.toLocaleString("en-US")}d (${years.toFixed(1)}y)`;
}

export function formatPct(ratioOrPct: number | null | undefined, isRatio = true): string {
  if (ratioOrPct === null || ratioOrPct === undefined || Number.isNaN(ratioOrPct)) {
    return "—";
  }
  const pct = isRatio ? ratioOrPct * 100 : ratioOrPct;
  return `${pct.toFixed(1)}%`;
}

export function resolveBrowserSupport(
  support: CompactBrowserSupport | undefined,
  browser: string,
  opts: SupportFilterOptions,
): TimelinePoint | null {
  if (!support) return null;

  if (support.v !== undefined && support.d !== undefined) {
    return {
      browser,
      version: support.v,
      day: support.d,
      approx: support.le === 1,
    };
  }

  const candidates: TimelinePoint[] = [];
  if (!opts.excludePartial && support.p) {
    candidates.push({
      browser,
      version: support.p[0],
      day: support.p[1],
      approx: support.p[2] === 1,
      caveat: "partial",
    });
  }
  if (opts.includePrefixed && support.x) {
    candidates.push({
      browser,
      version: support.x[0],
      day: support.x[1],
      approx: support.x[2] === 1,
      caveat: "prefixed",
    });
  }
  if (opts.includeFlagged && support.f) {
    candidates.push({
      browser,
      version: support.f[0],
      day: support.f[1],
      approx: support.f[2] === 1,
      caveat: "flagged",
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.day - b.day);
  return candidates[0];
}

export function evaluateFeatureSupport(
  feature: CompactFeature,
  selectedBrowsers: readonly string[],
  opts: SupportFilterOptions,
  refEpochDay: number,
): FeatureEvaluation {
  const timeline: TimelinePoint[] = [];
  const missingBrowsers: string[] = [];
  const removedPoints: BrowserPoint[] = [];
  let hasCaveat = false;

  for (const browser of selectedBrowsers) {
    const raw = feature.s[browser];
    const point = resolveBrowserSupport(raw, browser, opts);
    if (point) {
      timeline.push(point);
      if (point.caveat) hasCaveat = true;
    } else {
      missingBrowsers.push(browser);
    }

    if (raw && raw.rd !== undefined && raw.rv !== undefined) {
      removedPoints.push({
        browser,
        version: raw.rv,
        day: raw.rd,
      });
    }
  }

  timeline.sort((a, b) => a.day - b.day);
  const first: BrowserPoint | null = timeline.length > 0
    ? {
        browser: timeline[0].browser,
        version: timeline[0].version,
        day: timeline[0].day,
      }
    : null;

  const isStable =
    selectedBrowsers.length > 0 &&
    missingBrowsers.length === 0 &&
    timeline.length === selectedBrowsers.length;

  const lastPoint = timeline.length > 1
    ? timeline[timeline.length - 1]
    : isStable && timeline.length === 1
    ? timeline[0]
    : null;

  const last: BrowserPoint | null = lastPoint
    ? {
        browser: lastPoint.browser,
        version: lastPoint.version,
        day: lastPoint.day,
      }
    : null;

  const ageInDays =
    isStable && first && last ? Math.max(0, last.day - first.day) : null;
  const limboDays =
    !isStable && first ? Math.max(0, refEpochDay - first.day) : null;

  let removed: RemovedStats | null = null;
  if (removedPoints.length > 0) {
    removedPoints.sort((a, b) => a.day - b.day);
    const rFirst = removedPoints[0];
    const rLast = removedPoints[removedPoints.length - 1];
    removed = {
      isRemoved:
        selectedBrowsers.length > 0 &&
        removedPoints.length === selectedBrowsers.length,
      first: rFirst,
      last: rLast,
      ageInDays: Math.max(0, rLast.day - rFirst.day),
      browsers: removedPoints.map((r) => r.browser),
    };
  }

  return {
    id: feature.id,
    cat: feature.cat,
    mdnUrl: expandMdnUrl(feature.mdn),
    specUrl: feature.spec,
    status: {
      standardTrack: (feature.st & 1) !== 0,
      experimental: (feature.st & 2) !== 0,
      deprecated: (feature.st & 4) !== 0,
    },
    baseline: feature.bl,
    baselineLowDay: feature.bld,
    wfId: feature.wf,
    notes: feature.notes,
    browserTimeline: timeline,
    missingBrowsers,
    first,
    last,
    isStable,
    ageInDays,
    limboDays,
    removed,
    hasCaveat,
  };
}

export function evaluateWebFeatureSupport(
  wf: CompactWebFeature,
  selectedBrowsers: readonly string[],
  refEpochDay: number,
): FeatureEvaluation {
  const timeline: TimelinePoint[] = [];
  const missingBrowsers: string[] = [];

  for (const browser of selectedBrowsers) {
    const raw = wf.s[browser];
    if (raw) {
      timeline.push({
        browser,
        version: raw.v,
        day: raw.d,
        approx: raw.le === 1,
      });
    } else {
      missingBrowsers.push(browser);
    }
  }

  timeline.sort((a, b) => a.day - b.day);
  const first: BrowserPoint | null = timeline.length > 0
    ? {
        browser: timeline[0].browser,
        version: timeline[0].version,
        day: timeline[0].day,
      }
    : null;

  const isStable =
    selectedBrowsers.length > 0 &&
    missingBrowsers.length === 0 &&
    timeline.length === selectedBrowsers.length;

  const lastPoint = timeline.length > 1
    ? timeline[timeline.length - 1]
    : isStable && timeline.length === 1
    ? timeline[0]
    : null;

  const last: BrowserPoint | null = lastPoint
    ? {
        browser: lastPoint.browser,
        version: lastPoint.version,
        day: lastPoint.day,
      }
    : null;

  const ageInDays =
    isStable && first && last ? Math.max(0, last.day - first.day) : null;
  const limboDays =
    !isStable && first ? Math.max(0, refEpochDay - first.day) : null;

  const primaryCat: CategorySlug = wf.cats[0] ?? "api";

  return {
    id: wf.id,
    name: wf.name,
    description: wf.description,
    cat: primaryCat,
    cats: wf.cats,
    specUrl: wf.spec,
    status: {
      standardTrack: true,
      experimental: wf.baseline === false,
      deprecated: false,
    },
    baseline: wf.baseline,
    baselineLowDay: wf.baselineLowDay,
    wfId: wf.id,
    group: wf.group,
    groupName: wf.groupName,
    browserTimeline: timeline,
    missingBrowsers,
    first,
    last,
    isStable,
    ageInDays,
    limboDays,
    removed: null,
    hasCaveat: false,
  };
}

export function toRowSnapshot(ev: FeatureEvaluation): CompactFeatureRowSnapshot {
  return {
    id: ev.id,
    name: ev.name,
    cat: ev.cat,
    mdnUrl: ev.mdnUrl,
    specUrl: ev.specUrl,
    baseline: ev.baseline,
    isStable: ev.isStable,
    ageInDays: ev.ageInDays,
    limboDays: ev.limboDays,
    first: ev.first,
    last: ev.last,
    browserTimeline: ev.browserTimeline,
    missingBrowsers: ev.missingBrowsers,
    hasCaveat: ev.hasCaveat,
    notes: ev.notes,
  };
}

export function caveatLabel(caveat: CaveatKind): string {
  if (caveat === "partial") return "Partial";
  if (caveat === "prefixed") return "Prefixed";
  return "Flagged";
}
