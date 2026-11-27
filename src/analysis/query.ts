import type {
  AnalysisMode,
  CategorySlug,
  ParsedQuery,
  ResponseFormat,
  SortDirection,
  SortField,
} from "../types.ts";

export const CATEGORIES: readonly CategorySlug[] = [
  "api",
  "css",
  "html",
  "http",
  "javascript",
  "webassembly",
];

export const CATEGORY_LABELS: Record<CategorySlug, string> = {
  api: "DOM API",
  css: "CSS",
  html: "HTML",
  http: "HTTP",
  javascript: "JS",
  webassembly: "WebAssembly",
};

export const DEFAULT_BROWSERS: readonly string[] = [
  "chrome",
  "firefox",
  "safari",
];

export const DEFAULT_CATEGORIES: readonly CategorySlug[] = [
  "api",
  "css",
  "html",
  "javascript",
];

export interface BrowserPreset {
  id: string;
  slug: string;
  label: string;
  browsers: readonly string[];
  description: string;
}

export const BROWSER_PRESETS: readonly BrowserPreset[] = [
  {
    id: "core-3",
    slug: "chrome-vs-firefox-vs-safari",
    label: "Core 3 Desktop",
    browsers: ["chrome", "firefox", "safari"],
    description: "Chrome, Firefox, and Safari",
  },
  {
    id: "core-4",
    slug: "chrome-edge-firefox-safari",
    label: "Core 4 Desktop",
    browsers: ["chrome", "edge", "firefox", "safari"],
    description: "Chrome, Edge, Firefox, and Safari",
  },
  {
    id: "baseline-7",
    slug: "baseline-core-7",
    label: "Baseline Core 7",
    browsers: [
      "chrome",
      "chrome_android",
      "edge",
      "firefox",
      "firefox_android",
      "safari",
      "safari_ios",
    ],
    description: "All 7 WebDX Baseline desktop & mobile browsers",
  },
  {
    id: "chrome-safari",
    slug: "chrome-vs-safari",
    label: "Chrome vs Safari",
    browsers: ["chrome", "safari"],
    description: "Blink (Chrome) vs WebKit (Safari)",
  },
  {
    id: "chrome-firefox",
    slug: "chrome-vs-firefox",
    label: "Chrome vs Firefox",
    browsers: ["chrome", "firefox"],
    description: "Blink (Chrome) vs Gecko (Firefox)",
  },
  {
    id: "firefox-safari",
    slug: "firefox-vs-safari",
    label: "Firefox vs Safari",
    browsers: ["firefox", "safari"],
    description: "Gecko (Firefox) vs WebKit (Safari)",
  },
  {
    id: "mobile",
    slug: "mobile-browsers",
    label: "Mobile Core",
    browsers: ["chrome_android", "firefox_android", "safari_ios"],
    description: "Chrome Android, Firefox Android, and Safari iOS",
  },
  {
    id: "desktop-vs-mobile",
    slug: "desktop-vs-mobile",
    label: "Desktop vs Mobile",
    browsers: ["chrome", "chrome_android", "safari", "safari_ios"],
    description: "Desktop & mobile Chrome and Safari",
  },
];

const VALID_CATEGORY_SET = new Set<string>(CATEGORIES);
const VALID_SORT_SET = new Set<string>([
  "api",
  "firstDate",
  "lastDate",
  "days",
  "limbo",
]);
const VALID_FORMATS = new Set<string>(["html", "csv", "rss", "json", "md"]);

export function negotiateFormat(request: Request): ResponseFormat {
  const url = new URL(request.url);
  const explicit = url.searchParams.get("type")?.toLowerCase();
  if (explicit && VALID_FORMATS.has(explicit)) {
    return explicit as ResponseFormat;
  }

  const accept = (request.headers.get("accept") || "").toLowerCase();
  if (accept.includes("text/markdown")) {
    return "md";
  }
  if (
    accept.includes("application/json") &&
    !accept.includes("text/html") &&
    !accept.includes("*/*")
  ) {
    return "json";
  }
  return "html";
}

export function matchPresetSlug(browsers: readonly string[]): string | null {
  const sorted = [...browsers].sort().join(",");
  for (const preset of BROWSER_PRESETS) {
    const pSorted = [...preset.browsers].sort().join(",");
    if (sorted === pSorted) return preset.slug;
  }
  return null;
}

export function parseCompareSlug(
  slug: string,
  sub?: string,
): {
  browsers: string[];
  categories: CategorySlug[];
  viewOverride?: "not-stable" | "when-stable";
} | null {
  const cleanSlug = slug.toLowerCase().trim();
  const preset = BROWSER_PRESETS.find((p) => p.slug === cleanSlug);
  let browsers: string[] = [];

  if (preset) {
    browsers = [...preset.browsers];
  } else if (cleanSlug.includes("-vs-")) {
    browsers = cleanSlug.split("-vs-").filter(Boolean);
  } else {
    return null;
  }

  if (browsers.length < 2) return null;

  let categories: CategorySlug[] = [...DEFAULT_CATEGORIES];
  let viewOverride: "not-stable" | "when-stable" | undefined;

  if (sub) {
    const cleanSub = sub.toLowerCase().trim();
    if (VALID_CATEGORY_SET.has(cleanSub)) {
      categories = [cleanSub as CategorySlug];
    } else if (cleanSub === "all") {
      categories = [...CATEGORIES];
    } else if (cleanSub === "not-stable" || cleanSub === "when-stable") {
      viewOverride = cleanSub;
    } else {
      return null;
    }
  }

  return { browsers, categories, viewOverride };
}

export interface ParseQueryOptions {
  requireBrowsers?: boolean;
  defaultBrowsers?: readonly string[];
  defaultCategories?: readonly CategorySlug[];
  defaultSort?: SortField;
  defaultDir?: SortDirection;
  slugBrowsers?: readonly string[];
  slugCategories?: readonly CategorySlug[];
}

export function parseQuery(
  request: Request,
  validBrowserIds: readonly string[],
  opts: ParseQueryOptions = {},
): ParsedQuery {
  const url = new URL(request.url);
  const params = url.searchParams;
  const validBrowserSet = new Set(validBrowserIds);
  const requireBrowsers = opts.requireBrowsers ?? true;

  const browserList: string[] = [];
  const categoryList: CategorySlug[] = [];

  if (opts.slugBrowsers && opts.slugBrowsers.length > 0) {
    for (const b of opts.slugBrowsers) {
      if (validBrowserSet.has(b) && !browserList.includes(b)) {
        browserList.push(b);
      }
    }
  } else {
    for (const [key, value] of params.entries()) {
      if (key.startsWith("browser-") && value !== "off" && value !== "false") {
        const id = key.slice("browser-".length);
        if (validBrowserSet.has(id) && !browserList.includes(id)) {
          browserList.push(id);
        }
      }
    }
    const commaBrowsers = params.get("browsers");
    if (commaBrowsers) {
      for (const raw of commaBrowsers.split(",")) {
        const id = raw.trim();
        if (validBrowserSet.has(id) && !browserList.includes(id)) {
          browserList.push(id);
        }
      }
    }
  }

  if (opts.slugCategories && opts.slugCategories.length > 0) {
    for (const c of opts.slugCategories) {
      if (VALID_CATEGORY_SET.has(c) && !categoryList.includes(c)) {
        categoryList.push(c);
      }
    }
  } else {
    for (const [key, value] of params.entries()) {
      if (key.startsWith("feature-") && value !== "off" && value !== "false") {
        const cat = key.slice("feature-".length);
        if (
          VALID_CATEGORY_SET.has(cat) &&
          !categoryList.includes(cat as CategorySlug)
        ) {
          categoryList.push(cat as CategorySlug);
        }
      }
    }
    const commaCats = params.get("categories");
    if (commaCats) {
      for (const raw of commaCats.split(",")) {
        const cat = raw.trim();
        if (
          VALID_CATEGORY_SET.has(cat) &&
          !categoryList.includes(cat as CategorySlug)
        ) {
          categoryList.push(cat as CategorySlug);
        }
      }
    }
  }

  const hasExplicitBrowsers =
    (opts.slugBrowsers?.length ?? 0) > 0 ||
    params.has("browsers") ||
    [...params.keys()].some((k) => k.startsWith("browser-"));

  const hasExplicitFeatures =
    (opts.slugCategories?.length ?? 0) > 0 ||
    params.has("categories") ||
    [...params.keys()].some((k) => k.startsWith("feature-"));

  const isBareEmptyQuery = url.search === "?";
  const explicitlySubmitted =
    params.get("submitted") === "1" ||
    hasExplicitBrowsers ||
    hasExplicitFeatures ||
    isBareEmptyQuery;

  let isDefaultSelection = false;
  let browsers = browserList;
  let categories = categoryList;

  if (!explicitlySubmitted) {
    isDefaultSelection = true;
    browsers = [...(opts.defaultBrowsers ?? DEFAULT_BROWSERS)].filter((b) =>
      validBrowserSet.has(b)
    );
    categories = [...(opts.defaultCategories ?? DEFAULT_CATEGORIES)];
  } else if (
    hasExplicitBrowsers &&
    !hasExplicitFeatures &&
    params.get("submitted") !== "1" &&
    opts.defaultCategories
  ) {
    categories = [...opts.defaultCategories];
  } else if (
    !hasExplicitBrowsers &&
    !requireBrowsers &&
    params.get("submitted") !== "1"
  ) {
    browsers = [...(opts.defaultBrowsers ?? DEFAULT_BROWSERS)].filter((b) =>
      validBrowserSet.has(b)
    );
    if (!hasExplicitFeatures) {
      categories = [...(opts.defaultCategories ?? CATEGORIES)];
    }
  }

  const warnings: string[] = [];
  if (explicitlySubmitted && requireBrowsers && browsers.length < 2) {
    warnings.push("Choose at least two browsers to compare");
  }
  if (explicitlySubmitted && categories.length < 1) {
    warnings.push("Choose at least one feature category to show");
  }

  const modeRaw = params.get("mode");
  const mode: AnalysisMode =
    modeRaw === "web-features" ? "web-features" : "bcd";

  const format = negotiateFormat(request);

  const excludePartial = params.get("exclude-partial") === "on";
  const includePrefixed = params.get("include-prefixed") === "on";
  const includeFlagged = params.get("include-flagged") === "on";

  const sinceRaw = params.get("since");
  let sinceYear: number | null = null;
  if (sinceRaw) {
    const parsedYear = Number.parseInt(sinceRaw, 10);
    if (Number.isFinite(parsedYear) && parsedYear >= 1995 && parsedYear <= 2035) {
      sinceYear = parsedYear;
    }
  }

  const search = (params.get("q") || "").trim().slice(0, 120);
  const catFilterRaw = params.get("cat") || "";
  const filterCategory: CategorySlug | "" = VALID_CATEGORY_SET.has(catFilterRaw)
    ? (catFilterRaw as CategorySlug)
    : "";

  const blRaw = params.get("baseline") || "";
  const filterBaseline: "" | "high" | "low" | "limited" =
    blRaw === "high" || blRaw === "low" || blRaw === "limited" ? blRaw : "";

  const sortRaw = params.get("sort") || "";
  const sort: SortField = VALID_SORT_SET.has(sortRaw)
    ? (sortRaw as SortField)
    : opts.defaultSort ?? "api";

  const dirRaw = params.get("dir");
  const dir: SortDirection =
    dirRaw === "asc" || dirRaw === "desc"
      ? dirRaw
      : opts.defaultDir ?? "asc";

  const pageRaw = Number.parseInt(params.get("page") || "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  const pageSizeRaw = Number.parseInt(params.get("pageSize") || "25", 10);
  const pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw >= 10 && pageSizeRaw <= 200
      ? pageSizeRaw
      : 25;

  // Check if current selection matches a precomputed preset
  const presetSlug = matchPresetSlug(browsers);

  return {
    browsers,
    categories,
    mode,
    format,
    excludePartial,
    includePrefixed,
    includeFlagged,
    sinceYear,
    search,
    filterCategory,
    filterBaseline,
    sort,
    dir,
    page,
    pageSize,
    submitted: true,
    isDefaultSelection,
    warnings,
    presetSlug,
  };
}

export function buildSelectionParams(
  query: Pick<
    ParsedQuery,
    | "browsers"
    | "categories"
    | "mode"
    | "excludePartial"
    | "includePrefixed"
    | "includeFlagged"
    | "sinceYear"
  >,
  overrides: {
    format?: ResponseFormat;
    mode?: AnalysisMode;
    page?: number;
    sort?: SortField;
    dir?: SortDirection;
    q?: string;
    cat?: CategorySlug | "";
    baseline?: "" | "high" | "low" | "limited";
  } = {},
): string {
  const sp = new URLSearchParams();
  for (const b of [...query.browsers].sort()) {
    sp.set(`browser-${b}`, "on");
  }
  for (const c of [...query.categories].sort()) {
    sp.set(`feature-${c}`, "on");
  }
  const mode = overrides.mode ?? query.mode;
  if (mode !== "bcd") sp.set("mode", mode);
  if (query.excludePartial) sp.set("exclude-partial", "on");
  if (query.includePrefixed) sp.set("include-prefixed", "on");
  if (query.includeFlagged) sp.set("include-flagged", "on");
  if (query.sinceYear !== null) sp.set("since", String(query.sinceYear));
  if (overrides.q) sp.set("q", overrides.q);
  if (overrides.cat) sp.set("cat", overrides.cat);
  if (overrides.baseline) sp.set("baseline", overrides.baseline);
  if (overrides.sort && overrides.sort !== "api") sp.set("sort", overrides.sort);
  if (overrides.dir && overrides.dir !== "asc") sp.set("dir", overrides.dir);
  if (overrides.page && overrides.page > 1) sp.set("page", String(overrides.page));
  if (overrides.format && overrides.format !== "html") {
    sp.set("type", overrides.format);
  }
  return sp.toString();
}

export function buildCanonicalUrl(
  origin: string,
  pathname: string,
  query?: ParsedQuery,
): string {
  if (!query || query.isDefaultSelection) {
    return `${origin}${pathname}`;
  }
  if (pathname.startsWith("/compare/")) {
    const sp = new URLSearchParams();
    if (query.mode !== "bcd") sp.set("mode", query.mode);
    if (query.excludePartial) sp.set("exclude-partial", "on");
    if (query.includePrefixed) sp.set("include-prefixed", "on");
    if (query.includeFlagged) sp.set("include-flagged", "on");
    if (query.sinceYear !== null) sp.set("since", String(query.sinceYear));
    const qs = sp.toString();
    return qs ? `${origin}${pathname}?${qs}` : `${origin}${pathname}`;
  }
  if (
    pathname === "/" &&
    query.presetSlug &&
    !query.excludePartial &&
    !query.includePrefixed &&
    !query.includeFlagged &&
    query.sinceYear === null &&
    query.mode === "bcd"
  ) {
    const catsSorted = [...query.categories].sort().join(",");
    const defaultCatsSorted = [...DEFAULT_CATEGORIES].sort().join(",");
    if (catsSorted === defaultCatsSorted) {
      return `${origin}/compare/${query.presetSlug}`;
    }
    if (query.categories.length === 1) {
      return `${origin}/compare/${query.presetSlug}/${query.categories[0]}`;
    }
  }
  const qs = buildSelectionParams(query);
  return qs ? `${origin}${pathname}?${qs}` : `${origin}${pathname}`;
}
