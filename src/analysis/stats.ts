import { computeKaplanMeier } from "./survival.ts";
import { epochDayToYear } from "./support.ts";
import type {
  AnalysisSummary,
  BrowserCohortMetric,
  BrowserShareRow,
  CategorySlug,
  CategorySummaryRow,
  CrossTabResult,
  DistributionBucket,
  DistributionStats,
  FeatureEvaluation,
  YearlyCohortRow,
} from "../types.ts";

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

export function quantile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return round1(sorted[0]);
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return round1(sorted[lo]);
  const interp = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  return round1(interp);
}

const BUCKET_DEFS: ReadonlyArray<{
  label: string;
  minDays: number;
  maxDays: number | null;
}> = [
  { label: "Same day (0d)", minDays: 0, maxDays: 0 },
  { label: "1–30d", minDays: 1, maxDays: 30 },
  { label: "31–180d (≤6m)", minDays: 31, maxDays: 180 },
  { label: "181–365d (≤1y)", minDays: 181, maxDays: 365 },
  { label: "1–2y", minDays: 366, maxDays: 730 },
  { label: "2–5y", minDays: 731, maxDays: 1825 },
  { label: "5y+", minDays: 1826, maxDays: null },
];

export function computeDistribution(values: readonly number[]): DistributionStats {
  const count = values.length;
  const buckets: DistributionBucket[] = BUCKET_DEFS.map((b) => ({
    label: b.label,
    minDays: b.minDays,
    maxDays: b.maxDays,
    count: 0,
    pct: 0,
  }));

  if (count === 0) {
    return {
      count: 0,
      mean: null,
      median: null,
      p25: null,
      p75: null,
      iqr: null,
      p90: null,
      min: null,
      max: null,
      fastFollowPct: null,
      buckets,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  let fastFollowCount = 0;

  for (const val of sorted) {
    sum += val;
    if (val <= 30) fastFollowCount++;
    for (const bucket of buckets) {
      if (
        val >= bucket.minDays &&
        (bucket.maxDays === null || val <= bucket.maxDays)
      ) {
        bucket.count++;
        break;
      }
    }
  }

  for (const bucket of buckets) {
    bucket.pct = round1((bucket.count / count) * 100);
  }

  const p25 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const p75 = quantile(sorted, 0.75);
  const p90 = quantile(sorted, 0.9);
  const iqr = p25 !== null && p75 !== null ? round1(p75 - p25) : null;

  return {
    count,
    mean: round1(sum / count),
    median,
    p25,
    p75,
    iqr,
    p90,
    min: sorted[0],
    max: sorted[count - 1],
    fastFollowPct: round1((fastFollowCount / count) * 100),
    buckets,
  };
}

function emptyMatrix(browsers: readonly string[]): Record<string, Record<string, number>> {
  const matrix: Record<string, Record<string, number>> = {};
  for (const row of browsers) {
    matrix[row] = {};
    for (const col of browsers) {
      matrix[row][col] = 0;
    }
  }
  return matrix;
}

export function computeCrossTab(
  evaluations: readonly FeatureEvaluation[],
  selectedBrowsers: readonly string[],
): CrossTabResult {
  const matrix = emptyMatrix(selectedBrowsers);
  const rowTotals: Record<string, number> = {};
  const colTotals: Record<string, number> = {};
  for (const b of selectedBrowsers) {
    rowTotals[b] = 0;
    colTotals[b] = 0;
  }

  let total = 0;
  for (const ev of evaluations) {
    if (!ev.isStable || !ev.first || !ev.last) continue;
    const f = ev.first.browser;
    const l = ev.last.browser;
    if (!(f in matrix) || !(l in matrix[f])) continue;
    matrix[f][l]++;
    rowTotals[f]++;
    colTotals[l]++;
    total++;
  }

  return {
    browsers: [...selectedBrowsers],
    matrix,
    rowTotals,
    colTotals,
    total,
  };
}

export function computeMissingCrossTab(
  evaluations: readonly FeatureEvaluation[],
  selectedBrowsers: readonly string[],
): CrossTabResult {
  const matrix = emptyMatrix(selectedBrowsers);
  const rowTotals: Record<string, number> = {};
  const colTotals: Record<string, number> = {};
  for (const b of selectedBrowsers) {
    rowTotals[b] = 0;
    colTotals[b] = 0;
  }

  let total = 0;
  for (const ev of evaluations) {
    if (ev.isStable || ev.browserTimeline.length === 0) continue;
    total++;
    const present = ev.browserTimeline.map((t) => t.browser);
    for (const bIn of present) {
      if (bIn in rowTotals) rowTotals[bIn]++;
    }
    for (const bMiss of ev.missingBrowsers) {
      if (bMiss in colTotals) colTotals[bMiss]++;
      for (const bIn of present) {
        if (bIn in matrix && bMiss in matrix[bIn]) {
          matrix[bIn][bMiss]++;
        }
      }
    }
  }

  return {
    browsers: [...selectedBrowsers],
    matrix,
    rowTotals,
    colTotals,
    total,
  };
}

function summarizeValues(values: readonly number[]): BrowserCohortMetric {
  if (values.length === 0) {
    return { count: 0, medianDays: null, meanDays: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  for (const v of sorted) sum += v;
  return {
    count: sorted.length,
    medianDays: quantile(sorted, 0.5),
    meanDays: round1(sum / sorted.length),
  };
}

export function computeAnalysisSummary(
  evaluations: readonly FeatureEvaluation[],
  selectedBrowsers: readonly string[],
  selectedCategories: readonly CategorySlug[],
): AnalysisSummary {
  const landed = evaluations.filter((e) => e.first !== null);
  const stable = landed.filter((e) => e.isStable && e.ageInDays !== null);
  const waiting = landed.filter((e) => !e.isStable && e.limboDays !== null);

  const stableAges = stable.map((e) => e.ageInDays as number);
  const distribution = computeDistribution(stableAges);

  const survival = computeKaplanMeier(
    landed.map((e) => ({
      timeDays: e.isStable ? (e.ageInDays as number) : (e.limboDays as number),
      event: e.isStable,
    })),
  );

  const crossTab = computeCrossTab(stable, selectedBrowsers);
  const missingCrossTab = computeMissingCrossTab(waiting, selectedBrowsers);

  // Per-category summary
  const byCategory: CategorySummaryRow[] = selectedCategories.map((cat) => {
    const catLanded = landed.filter((e) =>
      e.cats ? e.cats.includes(cat) : e.cat === cat
    );
    const catStable = catLanded.filter((e) => e.isStable && e.ageInDays !== null);
    const catAges = catStable.map((e) => e.ageInDays as number);
    const catDist = computeDistribution(catAges);
    const catKm = computeKaplanMeier(
      catLanded.map((e) => ({
        timeDays: e.isStable ? (e.ageInDays as number) : (e.limboDays as number),
        event: e.isStable,
      })),
    );
    return {
      category: cat,
      totalLanded: catLanded.length,
      stableCount: catStable.length,
      waitingCount: catLanded.length - catStable.length,
      completionRate: catLanded.length > 0
        ? round1((catStable.length / catLanded.length) * 100) / 100
        : 0,
      medianDays: catDist.median,
      p90Days: catDist.p90,
      meanDays: catDist.mean,
      km1yPct: catKm.probStableBy.d365,
    };
  });

  // Yearly cohorts (chronological ascending)
  const yearGroups = new Map<number, FeatureEvaluation[]>();
  for (const ev of landed) {
    const year = epochDayToYear(ev.first!.day);
    let bucket = yearGroups.get(year);
    if (!bucket) {
      bucket = [];
      yearGroups.set(year, bucket);
    }
    bucket.push(ev);
  }

  const yearsSorted = [...yearGroups.keys()].sort((a, b) => a - b);
  const yearlyCohorts: YearlyCohortRow[] = yearsSorted.map((year) => {
    const items = yearGroups.get(year)!;
    const yStable = items.filter((e) => e.isStable && e.ageInDays !== null);
    const yAges = yStable.map((e) => e.ageInDays as number);
    const yDist = computeDistribution(yAges);
    const yKm = computeKaplanMeier(
      items.map((e) => ({
        timeDays: e.isStable ? (e.ageInDays as number) : (e.limboDays as number),
        event: e.isStable,
      })),
    );
    const completionRate = items.length > 0 ? yStable.length / items.length : 0;

    const byCat: Partial<Record<CategorySlug, BrowserCohortMetric>> = {};
    for (const cat of selectedCategories) {
      const catVals = yStable
        .filter((e) => (e.cats ? e.cats.includes(cat) : e.cat === cat))
        .map((e) => e.ageInDays as number);
      byCat[cat] = summarizeValues(catVals);
    }

    const firstBrowser: Record<string, BrowserCohortMetric> = {};
    const lastBrowser: Record<string, BrowserCohortMetric> = {};
    for (const b of selectedBrowsers) {
      const firstVals = yStable
        .filter((e) => e.first?.browser === b)
        .map((e) => e.ageInDays as number);
      const lastVals = yStable
        .filter((e) => e.last?.browser === b)
        .map((e) => e.ageInDays as number);
      if (firstVals.length > 0) firstBrowser[b] = summarizeValues(firstVals);
      if (lastVals.length > 0) lastBrowser[b] = summarizeValues(lastVals);
    }

    return {
      year,
      totalLanded: items.length,
      stableCount: yStable.length,
      waitingCount: items.length - yStable.length,
      completionRate: round1(completionRate * 100) / 100,
      isRightCensored: completionRate < 0.8,
      medianDays: yDist.median,
      p90Days: yDist.p90,
      meanDays: yDist.mean,
      km1yPct: yKm.probStableBy.d365,
      km2yPct: yKm.probStableBy.d730,
      byCategory: byCat,
      firstBrowser,
      lastBrowser,
    };
  });

  // Browser share (overall Sprinters & Plodders)
  const totalStable = stable.length;
  const browserShare: BrowserShareRow[] = selectedBrowsers.map((b) => {
    const firstVals = stable
      .filter((e) => e.first?.browser === b)
      .map((e) => e.ageInDays as number);
    const lastVals = stable
      .filter((e) => e.last?.browser === b)
      .map((e) => e.ageInDays as number);
    const fStats = summarizeValues(firstVals);
    const lStats = summarizeValues(lastVals);
    return {
      browser: b,
      firstCount: fStats.count,
      firstPct: totalStable > 0 ? round1((fStats.count / totalStable) * 100) : 0,
      firstMedianDays: fStats.medianDays,
      lastCount: lStats.count,
      lastPct: totalStable > 0 ? round1((lStats.count / totalStable) * 100) : 0,
      lastMedianDays: lStats.medianDays,
    };
  });

  return {
    totalEvaluated: evaluations.length,
    totalLanded: landed.length,
    stableCount: stable.length,
    waitingCount: waiting.length,
    completionRate: landed.length > 0
      ? round1((stable.length / landed.length) * 100) / 100
      : 0,
    distribution,
    survival,
    crossTab,
    missingCrossTab,
    byCategory,
    yearlyCohorts,
    browserShare,
  };
}
