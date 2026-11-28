export type CategorySlug =
  | "api"
  | "css"
  | "html"
  | "http"
  | "javascript"
  | "webassembly";

export type BrowserType = "desktop" | "mobile" | "server" | "xr";
export type BrowserEngine = "blink" | "gecko" | "webkit" | "trident" | "server";

export interface BrowserMeta {
  id: string;
  name: string;
  shortName: string;
  type: BrowserType;
  engine: BrowserEngine;
  upstream?: string;
  isCore: boolean;
  latestVersion?: string;
  latestReleaseDate?: string;
}

export interface CategoryShardMeta {
  file: string;
  count: number;
  firstId: string;
  lastId: string;
}

export interface Manifest {
  schemaVersion: number;
  generatedAt: string;
  bcdVersion: string;
  bcdTimestamp: string;
  bcdEpochDay: number;
  webFeaturesVersion: string;
  counts: Record<CategorySlug, number>;
  categoryShards: Record<CategorySlug, CategoryShardMeta[]>;
  files: string[];
  webFeatureCount: number;
  categories: CategorySlug[];
}

export type CaveatTuple = [version: string, day: number, approx?: 1];

export interface CompactBrowserSupport {
  v?: string;
  d?: number;
  le?: 1;
  p?: CaveatTuple;
  x?: CaveatTuple;
  f?: CaveatTuple;
  rv?: string;
  rd?: number;
}

export interface CompactNote {
  t: string;
  b: string[];
}

export type BaselineTier = "high" | "low" | false;

export interface CompactFeature {
  id: string;
  cat: CategorySlug;
  mdn?: string;
  spec?: string;
  st: number; // bitmask: 1=standard_track, 2=experimental, 4=deprecated
  wf?: string;
  bl?: BaselineTier;
  bld?: number;
  s: Record<string, CompactBrowserSupport>;
  notes?: CompactNote[];
}

export interface CompactWebFeatureSupport {
  v: string;
  d: number;
  le?: 1;
}

export interface CompactWebFeature {
  id: string;
  name: string;
  description: string;
  group: string;
  groupName: string;
  spec?: string;
  baseline: BaselineTier;
  baselineLowDate?: string;
  baselineLowDay?: number;
  baselineHighDate?: string;
  compatCount: number;
  cats: CategorySlug[];
  compatKeysSample: string[];
  s: Record<string, CompactWebFeatureSupport>;
}

export type AnalysisMode = "bcd" | "web-features";
export type ResponseFormat = "html" | "csv" | "rss" | "json" | "md";
export type ViewKind =
  | "stable"
  | "not-stable"
  | "when-stable"
  | "baseline"
  | "experimental"
  | "deprecated"
  | "removed"
  | "all"
  | "stories"
  | "feature";

export type SortField = "api" | "firstDate" | "lastDate" | "days" | "limbo";
export type SortDirection = "asc" | "desc";

export interface SupportFilterOptions {
  excludePartial: boolean;
  includePrefixed: boolean;
  includeFlagged: boolean;
}

export interface ParsedQuery {
  browsers: string[];
  categories: CategorySlug[];
  mode: AnalysisMode;
  format: ResponseFormat;
  excludePartial: boolean;
  includePrefixed: boolean;
  includeFlagged: boolean;
  sinceYear: number | null;
  search: string;
  filterCategory: CategorySlug | "";
  filterBaseline: "" | "high" | "low" | "limited";
  filterFirst: string;
  filterLast: string;
  filterHas: string;
  filterMissing: string;
  sort: SortField;
  dir: SortDirection;
  page: number;
  pageSize: number;
  submitted: boolean;
  isDefaultSelection: boolean;
  warnings: string[];
  presetSlug: string | null;
}

export type CaveatKind = "partial" | "prefixed" | "flagged";

export interface TimelinePoint {
  browser: string;
  version: string;
  day: number;
  approx: boolean;
  caveat?: CaveatKind;
}

export interface BrowserPoint {
  browser: string;
  version: string;
  day: number;
}

export interface RemovedStats {
  isRemoved: boolean;
  first: BrowserPoint;
  last: BrowserPoint;
  ageInDays: number;
  browsers: string[];
}

export interface FeatureEvaluation {
  id: string;
  name?: string;
  description?: string;
  cat: CategorySlug;
  cats?: CategorySlug[];
  mdnUrl?: string;
  specUrl?: string;
  status: {
    standardTrack: boolean;
    experimental: boolean;
    deprecated: boolean;
  };
  baseline?: BaselineTier;
  baselineLowDay?: number;
  wfId?: string;
  group?: string;
  groupName?: string;
  notes?: CompactNote[];
  browserTimeline: TimelinePoint[];
  missingBrowsers: string[];
  first: BrowserPoint | null;
  last: BrowserPoint | null;
  isStable: boolean;
  ageInDays: number | null;
  limboDays: number | null;
  removed: RemovedStats | null;
  hasCaveat: boolean;
}

export interface SurvivalPoint {
  day: number;
  pctStable: number;
}

export interface SurvivalSummary {
  n: number;
  events: number;
  censored: number;
  completionRate: number;
  probStableBy: {
    d30: number | null;
    d90: number | null;
    d180: number | null;
    d365: number | null;
    d730: number | null;
    d1825: number | null;
  };
  kmMedianDays: number | null;
  curve: SurvivalPoint[];
}

export interface DistributionBucket {
  label: string;
  minDays: number;
  maxDays: number | null;
  count: number;
  pct: number;
}

export interface DistributionStats {
  count: number;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  iqr: number | null;
  p90: number | null;
  min: number | null;
  max: number | null;
  fastFollowPct: number | null;
  buckets: DistributionBucket[];
}

export interface CrossTabResult {
  browsers: string[];
  matrix: Record<string, Record<string, number>>;
  medianMatrix?: Record<string, Record<string, number | null>>;
  p90Matrix?: Record<string, Record<string, number | null>>;
  rowTotals: Record<string, number>;
  colTotals: Record<string, number>;
  total: number;
}

export interface BrowserCohortMetric {
  count: number;
  medianDays: number | null;
  meanDays: number | null;
}

export interface YearlyCohortRow {
  year: number;
  totalLanded: number;
  stableCount: number;
  waitingCount: number;
  completionRate: number;
  isRightCensored: boolean;
  medianDays: number | null;
  p90Days: number | null;
  meanDays: number | null;
  km1yPct: number | null;
  km2yPct: number | null;
  byCategory: Partial<Record<CategorySlug, BrowserCohortMetric>>;
  firstBrowser: Record<string, BrowserCohortMetric>;
  lastBrowser: Record<string, BrowserCohortMetric>;
}

export interface BrowserShareRow {
  browser: string;
  firstCount: number;
  firstPct: number;
  firstMedianDays: number | null;
  lastCount: number;
  lastPct: number;
  lastMedianDays: number | null;
}

export interface CategorySummaryRow {
  category: CategorySlug;
  totalLanded: number;
  stableCount: number;
  waitingCount: number;
  completionRate: number;
  medianDays: number | null;
  p90Days: number | null;
  meanDays: number | null;
  km1yPct: number | null;
}

export interface AnalysisSummary {
  totalEvaluated: number;
  totalLanded: number;
  stableCount: number;
  waitingCount: number;
  completionRate: number;
  distribution: DistributionStats;
  survival: SurvivalSummary;
  crossTab: CrossTabResult;
  missingCrossTab: CrossTabResult;
  byCategory: CategorySummaryRow[];
  yearlyCohorts: YearlyCohortRow[];
  browserShare: BrowserShareRow[];
}

export interface StoryMetric {
  label: string;
  value: string;
  detail?: string;
}

export interface StoryChartSeries {
  label: string;
  colorKey: "primary" | "secondary" | "tertiary" | "quaternary";
  points: Array<{ x: number; y: number; label?: string }>;
}

export interface StoryBarDatum {
  label: string;
  value: number;
  secondaryValue?: number;
  unit?: string;
  detail?: string;
}

export interface StoryTable {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

export interface StoryPayload {
  slug: string;
  title: string;
  subtitle: string;
  categoryTag: string;
  summary: string;
  methodology: string;
  keyTakeaways: string[];
  metrics: StoryMetric[];
  survivalCurves?: StoryChartSeries[];
  bars?: {
    title: string;
    caption: string;
    primaryLabel: string;
    secondaryLabel?: string;
    items: StoryBarDatum[];
  };
  tables: StoryTable[];
}

export interface BaselineGroupSummary {
  group: string;
  groupName: string;
  total: number;
  high: number;
  low: number;
  limited: number;
  widelyPct: number;
  medianTtaDays: number | null;
}

export interface BaselineSummary {
  total: number;
  high: number;
  low: number;
  limited: number;
  byGroup: BaselineGroupSummary[];
  yearlyNewlyAvailable: Array<{ year: number; count: number; medianDays: number | null }>;
  approachingWidelyAvailable: Array<{
    id: string;
    name: string;
    groupName: string;
    baselineLowDate: string;
    expectedHighDate: string;
    daysUntilHigh: number;
  }>;
  recentNewlyAvailable: Array<{
    id: string;
    name: string;
    groupName: string;
    baselineLowDate: string;
    ttaDays: number | null;
  }>;
}

export interface CompactFeatureRowSnapshot {
  id: string;
  name?: string;
  cat: CategorySlug;
  mdnUrl?: string;
  specUrl?: string;
  baseline?: BaselineTier;
  isStable: boolean;
  ageInDays: number | null;
  limboDays: number | null;
  first: BrowserPoint | null;
  last: BrowserPoint | null;
  browserTimeline: TimelinePoint[];
  missingBrowsers: string[];
  hasCaveat: boolean;
  notes?: CompactNote[];
}

export interface PrecomputedPreset {
  slug: string;
  mode: AnalysisMode;
  browsers: string[];
  categories: CategorySlug[];
  summary: AnalysisSummary;
  topRows: CompactFeatureRowSnapshot[];
  totalRows: number;
}

export interface PrecomputedData {
  generatedAt: string;
  bcdVersion: string;
  webFeaturesVersion: string;
  presets: Record<string, PrecomputedPreset>;
  stories: StoryPayload[];
  baselineSummary: BaselineSummary;
}

export interface HistorySnapshot {
  date: string;
  bcdVersion: string;
  webFeaturesVersion: string;
  bcdTotal: number;
  core3StableBcd: number;
  core3NotStableBcd: number;
  core3MedianTtaDaysBcd: number | null;
  webFeaturesTotal: number;
  baselineHigh: number;
  baselineLow: number;
  baselineLimited: number;
}

export interface SyncStatus {
  checkedAt: string;
  currentBcdVersion: string;
  currentWebFeaturesVersion: string;
  latestBcdVersion: string;
  latestWebFeaturesVersion: string;
  updateAvailable: boolean;
  lastUpdatedAt?: string;
  actionTriggered?: string;
  error?: string;
}

export interface FeatureLookupResult {
  kind: "web-feature" | "bcd";
  webFeature?: CompactWebFeature;
  bcdFeature?: CompactFeature;
  relatedBcdFeatures?: CompactFeature[];
}

export interface Env {
  ASSETS: Fetcher;
  DATA_BUCKET?: R2Bucket;
  CANONICAL_HOST?: string;
  REDIRECT_HOSTS?: string;
  DATA_SOURCE_URL?: string;
  SYNC_SECRET?: string;
}
