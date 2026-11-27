import { CATEGORIES, CATEGORY_LABELS } from "./query.ts";
import { computeDistribution, quantile } from "./stats.ts";
import {
  cleanIsoDate,
  epochDayToIso,
  epochDayToYear,
  evaluateFeatureSupport,
  evaluateWebFeatureSupport,
  formatDays,
  formatPct,
  DEFAULT_SUPPORT_OPTIONS,
} from "./support.ts";
import { computeKaplanMeier } from "./survival.ts";
import type {
  BaselineSummary,
  BrowserMeta,
  CategorySlug,
  CompactFeature,
  CompactWebFeature,
  FeatureEvaluation,
  HistorySnapshot,
  Manifest,
  StoryPayload,
} from "../types.ts";

const CORE3 = ["chrome", "firefox", "safari"] as const;

const ERAS = [
  { id: "pre-2015", label: "Pre-2015", min: 1995, max: 2014, colorKey: "quaternary" as const },
  { id: "2015-2018", label: "2015–2018", min: 2015, max: 2018, colorKey: "tertiary" as const },
  { id: "2019-2021", label: "2019–2021", min: 2019, max: 2021, colorKey: "secondary" as const },
  { id: "2022-plus", label: "2022+ (Interop)", min: 2022, max: 2099, colorKey: "primary" as const },
];

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function formatNum(v: number | null | undefined, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${Math.round(v).toLocaleString("en-US")}${suffix}`;
}

function shortBrowserName(id: string, browsers: readonly BrowserMeta[]): string {
  return browsers.find((b) => b.id === id)?.shortName ?? id;
}

function browserName(id: string, browsers: readonly BrowserMeta[]): string {
  return browsers.find((b) => b.id === id)?.name ?? id;
}

export function computeBaselineSummary(
  webFeatures: readonly CompactWebFeature[],
  manifest: Manifest,
): BaselineSummary {
  const refDay = manifest.bcdEpochDay;
  let high = 0;
  let low = 0;
  let limited = 0;

  const groupMap = new Map<
    string,
    {
      groupName: string;
      total: number;
      high: number;
      low: number;
      limited: number;
      ttaValues: number[];
    }
  >();

  const yearMap = new Map<number, number[]>();
  const approaching: BaselineSummary["approachingWidelyAvailable"] = [];
  const recent: BaselineSummary["recentNewlyAvailable"] = [];

  for (const wf of webFeatures) {
    if (wf.baseline === "high") high++;
    else if (wf.baseline === "low") low++;
    else limited++;

    const ev = evaluateWebFeatureSupport(wf, ["chrome", "chrome_android", "edge", "firefox", "firefox_android", "safari", "safari_ios"], refDay);
    const tta = ev.isStable && ev.ageInDays !== null ? ev.ageInDays : null;

    let grp = groupMap.get(wf.group);
    if (!grp) {
      grp = {
        groupName: wf.groupName || wf.group,
        total: 0,
        high: 0,
        low: 0,
        limited: 0,
        ttaValues: [],
      };
      groupMap.set(wf.group, grp);
    }
    grp.total++;
    if (wf.baseline === "high") grp.high++;
    else if (wf.baseline === "low") grp.low++;
    else grp.limited++;
    if (tta !== null) grp.ttaValues.push(tta);

    if (wf.baselineLowDate && wf.baselineLowDay !== undefined) {
      const y = epochDayToYear(wf.baselineLowDay);
      let yArr = yearMap.get(y);
      if (!yArr) {
        yArr = [];
        yearMap.set(y, yArr);
      }
      if (tta !== null) yArr.push(tta);
      else yArr.push(0);

      if (wf.baseline === "low") {
        // Widely available is ~30 months (~913 days) after baseline_low_date
        const estHighDay = wf.baselineLowDay + 913;
        const daysUntilHigh = estHighDay - refDay;
        if (daysUntilHigh >= 0 && daysUntilHigh <= 185) {
          approaching.push({
            id: wf.id,
            name: wf.name,
            groupName: wf.groupName || wf.group,
            baselineLowDate: wf.baselineLowDate,
            expectedHighDate: epochDayToIso(estHighDay),
            daysUntilHigh,
          });
        }
      }

      recent.push({
        id: wf.id,
        name: wf.name,
        groupName: wf.groupName || wf.group,
        baselineLowDate: wf.baselineLowDate,
        ttaDays: tta,
      });
    }
  }

  approaching.sort((a, b) => a.daysUntilHigh - b.daysUntilHigh);
  recent.sort((a, b) =>
    cleanIsoDate(b.baselineLowDate).localeCompare(cleanIsoDate(a.baselineLowDate)),
  );

  const byGroup = [...groupMap.entries()]
    .map(([group, g]) => {
      const sorted = [...g.ttaValues].sort((a, b) => a - b);
      return {
        group,
        groupName: g.groupName,
        total: g.total,
        high: g.high,
        low: g.low,
        limited: g.limited,
        widelyPct: g.total > 0 ? round1((g.high / g.total) * 100) : 0,
        medianTtaDays: quantile(sorted, 0.5),
      };
    })
    .sort((a, b) => b.total - a.total);

  const yearlyNewlyAvailable = [...yearMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, vals]) => {
      const sorted = [...vals].sort((a, b) => a - b);
      return {
        year,
        count: vals.length,
        medianDays: quantile(sorted, 0.5),
      };
    });

  return {
    total: webFeatures.length,
    high,
    low,
    limited,
    byGroup,
    yearlyNewlyAvailable,
    approachingWidelyAvailable: approaching.slice(0, 20),
    recentNewlyAvailable: recent.slice(0, 20),
  };
}

export function computeAllStories(
  allBcdFeatures: readonly CompactFeature[],
  webFeatures: readonly CompactWebFeature[],
  browsers: readonly BrowserMeta[],
  manifest: Manifest,
  history: readonly HistorySnapshot[],
): StoryPayload[] {
  const refDay = manifest.bcdEpochDay;

  // Evaluate Core 3 across both datasets once
  const wfCore3 = webFeatures.map((wf) =>
    evaluateWebFeatureSupport(wf, CORE3, refDay)
  );
  const bcdCore3 = allBcdFeatures.map((f) =>
    evaluateFeatureSupport(f, CORE3, DEFAULT_SUPPORT_OPTIONS, refDay)
  );

  // ---------------------------------------------------------------------------
  // Story 1: Is the Web Reaching Stability Faster? (Kaplan-Meier Eras)
  // ---------------------------------------------------------------------------
  const wfEraRows: Array<Array<string | number>> = [];
  const bcdEraRows: Array<Array<string | number>> = [];
  const survivalCurves: StoryPayload["survivalCurves"] = [];
  const eraBars: NonNullable<StoryPayload["bars"]>["items"] = [];

  let interopKm1y: number | null = null;
  let preInteropKm1y: number | null = null;
  let interopKm2y: number | null = null;
  let preInteropKm2y: number | null = null;

  for (const era of ERAS) {
    const wfSub = wfCore3.filter((e) => {
      if (!e.first) return false;
      const y = epochDayToYear(e.first.day);
      return y >= era.min && y <= era.max;
    });
    const wfKm = computeKaplanMeier(
      wfSub.map((e) => ({
        timeDays: e.isStable ? (e.ageInDays as number) : (e.limboDays as number),
        event: e.isStable,
      })),
    );
    const wfNaiveMedian = computeDistribution(
      wfSub.filter((e) => e.isStable && e.ageInDays !== null).map((e) => e.ageInDays as number),
    ).median;

    wfEraRows.push([
      era.label,
      wfKm.n,
      wfKm.events,
      wfKm.censored,
      formatPct(wfKm.completionRate),
      formatPct(wfKm.probStableBy.d365, false),
      formatPct(wfKm.probStableBy.d730, false),
      formatDays(wfKm.kmMedianDays),
      formatDays(wfNaiveMedian),
    ]);

    survivalCurves.push({
      label: era.label,
      colorKey: era.colorKey,
      points: wfKm.curve.map((pt) => ({
        x: pt.day,
        y: pt.pctStable,
        label: `${era.label} @ ${pt.day}d: ${pt.pctStable}%`,
      })),
    });

    eraBars.push({
      label: era.label,
      value: wfKm.probStableBy.d365 ?? 0,
      secondaryValue: wfKm.probStableBy.d730 ?? 0,
      unit: "%",
      detail: `${wfKm.n} Web Features (${wfKm.events} stable, ${wfKm.censored} waiting)`,
    });

    if (era.id === "2015-2018") {
      preInteropKm1y = wfKm.probStableBy.d365;
      preInteropKm2y = wfKm.probStableBy.d730;
    }
    if (era.id === "2022-plus") {
      interopKm1y = wfKm.probStableBy.d365;
      interopKm2y = wfKm.probStableBy.d730;
    }

    const bcdSub = bcdCore3.filter((e) => {
      if (!e.first) return false;
      const y = epochDayToYear(e.first.day);
      return y >= era.min && y <= era.max;
    });
    const bcdKm = computeKaplanMeier(
      bcdSub.map((e) => ({
        timeDays: e.isStable ? (e.ageInDays as number) : (e.limboDays as number),
        event: e.isStable,
      })),
    );
    const bcdNaiveMedian = computeDistribution(
      bcdSub.filter((e) => e.isStable && e.ageInDays !== null).map((e) => e.ageInDays as number),
    ).median;

    bcdEraRows.push([
      era.label,
      bcdKm.n,
      bcdKm.events,
      bcdKm.censored,
      formatPct(bcdKm.completionRate),
      formatPct(bcdKm.probStableBy.d365, false),
      formatPct(bcdKm.probStableBy.d730, false),
      formatDays(bcdKm.kmMedianDays),
      formatDays(bcdNaiveMedian),
    ]);
  }

  const story1: StoryPayload = {
    slug: "is-the-web-getting-faster",
    title: "Is the Web Reaching Stability Faster?",
    subtitle:
      "Separating real cross-browser acceleration from right-censoring bias using Kaplan–Meier survival analysis.",
    categoryTag: "Velocity & Interop",
    summary:
      "Raw yearly averages make recent years look artificially fast because slow features haven't finished converging yet (right-censoring). By tracking both stable and still-waiting features in a Kaplan–Meier survival model across Chrome, Firefox, and Safari, we measure the true probability of reaching stability within 1 and 2 years.",
    methodology:
      "Each Web Feature (WebDX) and BCD API key is anchored to the release date of the first core engine (Chrome, Firefox, or Safari) that shipped it unflagged. Features not yet in all three engines are right-censored at the dataset date rather than dropped.",
    keyTakeaways: [
      `In the Interop era (2022+), ${formatPct(interopKm1y, false)} of landed Web Features reached 3-engine stability within 1 year, compared to ${formatPct(preInteropKm1y, false)} in 2015–2018.`,
      `Within 2 years of first landing, ${formatPct(interopKm2y, false)} of 2022+ Web Features converged across Chrome, Firefox, and Safari vs. ${formatPct(preInteropKm2y, false)} in 2015–2018.`,
      "Notice how the naive completed-only median shrinks in recent cohorts even before features finish shipping — Kaplan–Meier survival curves expose the full pace honestly.",
    ],
    metrics: [
      {
        label: "2022+ 1-Year Convergence",
        value: formatPct(interopKm1y, false),
        detail: "KM probability (Web Features)",
      },
      {
        label: "2015–2018 1-Year Convergence",
        value: formatPct(preInteropKm1y, false),
        detail: "KM probability (Web Features)",
      },
      {
        label: "2022+ 2-Year Convergence",
        value: formatPct(interopKm2y, false),
        detail: "KM probability (Web Features)",
      },
      {
        label: "2015–2018 2-Year Convergence",
        value: formatPct(preInteropKm2y, false),
        detail: "KM probability (Web Features)",
      },
    ],
    survivalCurves,
    bars: {
      title: "1-Year vs. 2-Year Cross-Browser Convergence Rate by Era",
      caption:
        "Kaplan–Meier probability that a Web Feature reaches Chrome + Firefox + Safari within 365 days (primary) and 730 days (secondary).",
      primaryLabel: "1-Year KM %",
      secondaryLabel: "2-Year KM %",
      items: eraBars,
    },
    tables: [
      {
        title: "Web Features (WebDX) by First-Landing Era",
        columns: [
          "Era",
          "Landed",
          "Stable",
          "Waiting",
          "Complete",
          "1y KM %",
          "2y KM %",
          "KM Median",
          "Naive Median",
        ],
        rows: wfEraRows,
      },
      {
        title: "Granular BCD Keys by First-Landing Era",
        columns: [
          "Era",
          "Landed",
          "Stable",
          "Waiting",
          "Complete",
          "1y KM %",
          "2y KM %",
          "KM Median",
          "Naive Median",
        ],
        rows: bcdEraRows,
      },
    ],
  };

  // ---------------------------------------------------------------------------
  // Story 2: The Lumpy Web — Single-Engine Holdouts & Bottlenecks
  // ---------------------------------------------------------------------------
  const wfOneAway: Record<string, number> = { chrome: 0, firefox: 0, safari: 0 };
  const wfOnlyOne: Record<string, number> = { chrome: 0, firefox: 0, safari: 0 };
  const bcdOneAway: Record<string, number> = { chrome: 0, firefox: 0, safari: 0 };
  const bcdOnlyOne: Record<string, number> = { chrome: 0, firefox: 0, safari: 0 };
  const slowBottleneck: Record<string, number> = { chrome: 0, firefox: 0, safari: 0 };
  const oneAwayList: Array<{
    name: string;
    group: string;
    missing: string;
    limboDays: number;
    firstBrowser: string;
  }> = [];

  let totalWfOneAway = 0;
  let totalWfOnlyOne = 0;

  for (const ev of wfCore3) {
    if (ev.isStable && ev.ageInDays !== null && ev.ageInDays > 365 && ev.last) {
      slowBottleneck[ev.last.browser]++;
    }
    if (!ev.isStable && ev.browserTimeline.length === 2 && ev.missingBrowsers.length === 1) {
      const m = ev.missingBrowsers[0];
      wfOneAway[m]++;
      totalWfOneAway++;
      oneAwayList.push({
        name: ev.name || ev.id,
        group: ev.groupName || ev.cat,
        missing: browserName(m, browsers),
        limboDays: ev.limboDays ?? 0,
        firstBrowser: ev.first ? shortBrowserName(ev.first.browser, browsers) : "—",
      });
    } else if (!ev.isStable && ev.browserTimeline.length === 1 && (ev.limboDays ?? 0) > 730) {
      const only = ev.browserTimeline[0].browser;
      wfOnlyOne[only]++;
      totalWfOnlyOne++;
    }
  }

  for (const ev of bcdCore3) {
    if (!ev.isStable && ev.browserTimeline.length === 2 && ev.missingBrowsers.length === 1) {
      bcdOneAway[ev.missingBrowsers[0]]++;
    } else if (!ev.isStable && ev.browserTimeline.length === 1 && (ev.limboDays ?? 0) > 730) {
      bcdOnlyOne[ev.browserTimeline[0].browser]++;
    }
  }

  oneAwayList.sort((a, b) => b.limboDays - a.limboDays);
  const totalSlowBottleneck =
    slowBottleneck.chrome + slowBottleneck.firefox + slowBottleneck.safari;

  const story2: StoryPayload = {
    slug: "the-lumpy-web",
    title: "The Lumpy Web: Single-Engine Holdouts & Bottlenecks",
    subtitle:
      "Mapping the 'Almost Baseline' backlog — features shipped in two engines and waiting on just one more, plus multi-year single-engine exclusives.",
    categoryTag: "Interoperability Gaps",
    summary:
      "Even when two browser engines ship a capability, developers still have to guard or polyfill for the missing third. Breaking down un-converged features into 'One Browser Away' vs. 'Single-Engine Exclusives' reveals where the web platform feels most uneven.",
    methodology:
      "Evaluates Chrome, Firefox, and Safari on both Web Features and BCD keys. 'One Browser Away' counts features supported by 2 of 3 engines; 'Single-Engine >2y' counts features present in only 1 engine for over 730 days; 'Slow Bottleneck' counts which engine shipped last when total TTA exceeded 365 days.",
    keyTakeaways: [
      `${totalWfOneAway.toLocaleString("en-US")} Web Features are currently 'One Browser Away' from 3-engine stability (${wfOneAway.firefox} awaiting Firefox, ${wfOneAway.safari} awaiting Safari, ${wfOneAway.chrome} awaiting Chrome).`,
      `${totalWfOnlyOne.toLocaleString("en-US")} Web Features have remained single-engine for over 2 years (${wfOnlyOne.chrome} Chrome-only, ${wfOnlyOne.safari} Safari-only, ${wfOnlyOne.firefox} Firefox-only).`,
      `Among slow-converging Web Features (>1 year to stability), ${CORE3.map((b) => `${browserName(b, browsers)} was last ${totalSlowBottleneck ? round1((slowBottleneck[b] / totalSlowBottleneck) * 100) : 0}%`).join(", ")} of the time.`,
    ],
    metrics: [
      {
        label: "Almost Baseline (WF)",
        value: formatNum(totalWfOneAway),
        detail: "In 2 of 3 core engines",
      },
      {
        label: "Single-Engine >2y (WF)",
        value: formatNum(totalWfOnlyOne),
        detail: "Over 730 days in 1 engine",
      },
      {
        label: "Awaiting Firefox (WF)",
        value: formatNum(wfOneAway.firefox),
        detail: `${formatNum(bcdOneAway.firefox)} BCD keys`,
      },
      {
        label: "Awaiting Safari (WF)",
        value: formatNum(wfOneAway.safari),
        detail: `${formatNum(bcdOneAway.safari)} BCD keys`,
      },
    ],
    bars: {
      title: "Engine Holdout Profile (Web Features)",
      caption:
        "Missing from 1 engine ('One Browser Away', primary) vs. 2+ year single-engine exclusives (secondary).",
      primaryLabel: "One Browser Away (missing)",
      secondaryLabel: "Single-Engine >2y (exclusive)",
      items: CORE3.map((b) => ({
        label: browserName(b, browsers),
        value: wfOneAway[b],
        secondaryValue: wfOnlyOne[b],
        detail: `Slow-lane last-in: ${slowBottleneck[b]} times`,
      })),
    },
    tables: [
      {
        title: "Engine Lumpy-Web Breakdown",
        columns: [
          "Engine",
          "WF One-Away",
          "BCD One-Away",
          "WF Exclusive (>2y)",
          "BCD Exclusive (>2y)",
          "Last-In (>1y TTA)",
        ],
        rows: CORE3.map((b) => [
          browserName(b, browsers),
          wfOneAway[b],
          bcdOneAway[b],
          wfOnlyOne[b],
          bcdOnlyOne[b],
          `${slowBottleneck[b]} (${totalSlowBottleneck ? round1((slowBottleneck[b] / totalSlowBottleneck) * 100) : 0}%)`,
        ]),
      },
      {
        title: "Longest-Waiting 'One Browser Away' Web Features",
        columns: ["Feature", "Group", "First Engine", "Missing Engine", "Days Waiting"],
        rows: oneAwayList.slice(0, 20).map((r) => [
          r.name,
          r.group,
          r.firstBrowser,
          r.missing,
          formatDays(r.limboDays),
        ]),
      },
    ],
  };

  // ---------------------------------------------------------------------------
  // Story 3: The Mobile Parity Gap
  // ---------------------------------------------------------------------------
  const pairs: Array<{
    label: string;
    upstream: string;
    downstream: string;
  }> = [
    { label: "Chrome -> Chrome Android", upstream: "chrome", downstream: "chrome_android" },
    { label: "Chrome Android -> WebView Android", upstream: "chrome_android", downstream: "webview_android" },
    { label: "Firefox -> Firefox Android", upstream: "firefox", downstream: "firefox_android" },
    { label: "Safari -> Safari iOS", upstream: "safari", downstream: "safari_ios" },
    { label: "Safari iOS -> WebView iOS", upstream: "safari_ios", downstream: "webview_ios" },
  ];

  const pairRows: Array<Array<string | number>> = [];
  const pairBars: NonNullable<StoryPayload["bars"]>["items"] = [];
  const notableGaps: Array<{ pair: string; api: string; gapDays: number; status: string }> = [];

  for (const p of pairs) {
    let upCount = 0;
    let bothCount = 0;
    let sameDayCount = 0;
    let upOnlyCount = 0;
    const positiveLags: number[] = [];

    for (const f of allBcdFeatures) {
      const ev = evaluateFeatureSupport(f, [p.upstream, p.downstream], DEFAULT_SUPPORT_OPTIONS, refDay);
      const upPt = ev.browserTimeline.find((t) => t.browser === p.upstream);
      const downPt = ev.browserTimeline.find((t) => t.browser === p.downstream);
      if (!upPt) continue;
      upCount++;
      if (downPt) {
        bothCount++;
        const lag = downPt.day - upPt.day;
        if (lag <= 0) sameDayCount++;
        if (lag > 0) {
          positiveLags.push(lag);
          if (lag >= 365) {
            notableGaps.push({
              pair: p.label,
              api: f.id,
              gapDays: lag,
              status: `Delayed ${formatDays(lag)}`,
            });
          }
        }
      } else {
        upOnlyCount++;
      }
    }

    const sortedLags = [...positiveLags].sort((a, b) => a - b);
    const sameDayPct = bothCount > 0 ? round1((sameDayCount / bothCount) * 100) : 0;
    const medLag = quantile(sortedLags, 0.5);
    const p90Lag = quantile(sortedLags, 0.9);

    pairRows.push([
      p.label,
      upCount,
      bothCount,
      upOnlyCount,
      `${sameDayPct}%`,
      positiveLags.length,
      formatDays(medLag),
      formatDays(p90Lag),
    ]);
    pairBars.push({
      label: p.label,
      value: sameDayPct,
      secondaryValue: medLag ?? 0,
      unit: "%",
      detail: `${upOnlyCount} desktop-only BCD keys missing downstream`,
    });
  }

  notableGaps.sort((a, b) => b.gapDays - a.gapDays);

  const wfCore7 = webFeatures.map((wf) =>
    evaluateWebFeatureSupport(
      wf,
      ["chrome", "chrome_android", "edge", "firefox", "firefox_android", "safari", "safari_ios"],
      refDay,
    )
  );
  const core3StableCount = wfCore3.filter((e) => e.isStable).length;
  const core7StableCount = wfCore7.filter((e) => e.isStable).length;

  const story3: StoryPayload = {
    slug: "mobile-parity-gap",
    title: "The Mobile Parity Gap: Desktop vs. Mobile & WebView Lag",
    subtitle:
      "Quantifying how closely mobile browsers and embedded WebViews track their desktop counterparts across BCD.",
    categoryTag: "Mobile & WebViews",
    summary:
      "Desktop support does not always guarantee instant mobile availability. Comparing upstream desktop engines against their Android, iOS, and WebView siblings reveals high same-day parity in some pairs alongside real multi-month gaps and missing APIs in others.",
    methodology:
      "Pairs each upstream browser with its downstream mobile or WebView runtime across all standard BCD keys. Same-day parity measures shared features where mobile shipped on or before desktop; delayed lag measures positive day deltas when mobile arrived later.",
    keyTakeaways: [
      `Desktop-only Core 3 Web Features (${core3StableCount}) vs. Baseline Core 7 including mobile (${core7StableCount}) differ by ${core3StableCount - core7StableCount} features due to mobile gaps.`,
      `Review each desktop->mobile pair's desktop-only backlog and delayed-feature median lag to spot where embedded WebViews or mobile ports diverge.`,
    ],
    metrics: [
      {
        label: "Core 3 Desktop Stable (WF)",
        value: formatNum(core3StableCount),
        detail: "Chrome + Firefox + Safari",
      },
      {
        label: "Baseline Core 7 Stable (WF)",
        value: formatNum(core7StableCount),
        detail: "Adds Edge + Android + iOS",
      },
      {
        label: "Desktop-to-Mobile Gap (WF)",
        value: formatNum(core3StableCount - core7StableCount),
        detail: "On desktop, missing on mobile",
      },
      {
        label: "Desktop/Mobile Pairs Tracked",
        value: "5",
        detail: "Chrome, Firefox, Safari + WebViews",
      },
    ],
    bars: {
      title: "Same-Day Parity Rate Across Shared BCD Features",
      caption: "Percentage of shared BCD keys available on the downstream runtime on day 0.",
      primaryLabel: "Same-Day Parity %",
      items: pairBars,
    },
    tables: [
      {
        title: "Desktop vs. Mobile & WebView Parity Matrix (BCD Keys)",
        columns: [
          "Browser Pair",
          "Upstream Supported",
          "Both Supported",
          "Upstream Only",
          "Same-Day Parity",
          "Delayed Count",
          "Median Lag (if delayed)",
          "p90 Lag",
        ],
        rows: pairRows,
      },
      {
        title: "Largest Recorded Mobile / WebView Delays (BCD Keys)",
        columns: ["Pair", "API Key", "Delay"],
        rows: notableGaps.slice(0, 15).map((g) => [g.pair, g.api, g.status]),
      },
    ],
  };

  // ---------------------------------------------------------------------------
  // Story 4: The Long Tail — Marathons, Coordinated Sprints & Eternal Limbo
  // ---------------------------------------------------------------------------
  const stableWfCore3 = wfCore3.filter((e) => e.isStable && e.ageInDays !== null);
  const longestWf = [...stableWfCore3].sort((a, b) => (b.ageInDays ?? 0) - (a.ageInDays ?? 0));
  const recentMarathons = stableWfCore3
    .filter((e) => e.last && e.last.day >= refDay - 365 && (e.ageInDays ?? 0) >= 1095)
    .sort((a, b) => (b.ageInDays ?? 0) - (a.ageInDays ?? 0));
  const coordinatedSprints = stableWfCore3
    .filter((e) => e.last && e.last.day >= refDay - 730 && (e.ageInDays ?? 999) <= 30)
    .sort((a, b) => (b.last?.day ?? 0) - (a.last?.day ?? 0));
  const eternalLimbo = wfCore3
    .filter((e) => !e.isStable && e.limboDays !== null)
    .sort((a, b) => (b.limboDays ?? 0) - (a.limboDays ?? 0));

  const wfDist = computeDistribution(stableWfCore3.map((e) => e.ageInDays as number));

  const story4: StoryPayload = {
    slug: "the-long-tail",
    title: "The Long Tail: Marathons, Coordinated Sprints & Eternal Limbo",
    subtitle:
      "Inside the extreme skew of web platform convergence — why averages mislead and medians rule.",
    categoryTag: "Distributions & Outliers",
    summary:
      "Time-to-stable is heavily right-skewed: some features ship across all engines in the same month, while others wait a decade. Comparing the median, p90, recent 3+ year marathons, and coordinated sprints shows both sides of the distribution.",
    methodology:
      "Examines all 3-engine (Chrome, Firefox, Safari) Web Features. Recent marathons are features finishing within the past 365 days after >3 years in flight; coordinated sprints are features from the last 2 years converging within 30 days.",
    keyTakeaways: [
      `Across ${wfDist.count.toLocaleString("en-US")} stable Web Features, the median TTA is ${formatDays(wfDist.median)}, while the mean is ${formatDays(wfDist.mean)} and p90 stretches to ${formatDays(wfDist.p90)}.`,
      `${formatPct(wfDist.fastFollowPct, false)} of stable Web Features converged in 30 days or less; ${recentMarathons.length} multi-year marathons (>3y) finally crossed the finish line in the past year.`,
      `The longest stable Web Feature took ${longestWf[0] ? formatDays(longestWf[0].ageInDays) : "—"} (${longestWf[0]?.name ?? "—"}).`,
    ],
    metrics: [
      { label: "Median TTA (WF)", value: formatDays(wfDist.median), detail: `IQR: ${formatDays(wfDist.iqr)}` },
      { label: "p90 TTA (WF)", value: formatDays(wfDist.p90), detail: `Mean: ${formatDays(wfDist.mean)}` },
      { label: "Fast-Follow (≤30d)", value: formatPct(wfDist.fastFollowPct, false), detail: "Shipped within 1 month" },
      { label: "Recent Marathons", value: formatNum(recentMarathons.length), detail: ">3y old, finished last 12m" },
    ],
    bars: {
      title: "Time-to-Stable Distribution Across Core 3 Web Features",
      caption: "Percentage of stable Web Features falling into each convergence duration bucket.",
      primaryLabel: "% of Stable Web Features",
      items: wfDist.buckets.map((b) => ({
        label: b.label,
        value: b.pct,
        unit: "%",
        detail: `${b.count} features`,
      })),
    },
    tables: [
      {
        title: "Recently Finished Marathons (Finished ≤1y Ago After ≥3y Flight)",
        columns: ["Feature", "First Engine", "First Date", "Last Engine", "Stable Date", "Total Wait"],
        rows: recentMarathons.slice(0, 15).map((e) => [
          e.name || e.id,
          shortBrowserName(e.first!.browser, browsers),
          epochDayToIso(e.first!.day),
          shortBrowserName(e.last!.browser, browsers),
          epochDayToIso(e.last!.day),
          formatDays(e.ageInDays),
        ]),
      },
      {
        title: "Recent Coordinated Sprints (≤30 Days Cross-Engine, Last 2 Years)",
        columns: ["Feature", "Group", "First Engine", "Stable Date", "Span"],
        rows: coordinatedSprints.slice(0, 15).map((e) => [
          e.name || e.id,
          e.groupName || e.cat,
          shortBrowserName(e.first!.browser, browsers),
          epochDayToIso(e.last!.day),
          formatDays(e.ageInDays),
        ]),
      },
      {
        title: "Oldest Still-Waiting Web Features (Eternal Limbo)",
        columns: ["Feature", "Present In", "Missing", "First Shipped", "Days in Limbo"],
        rows: eternalLimbo.slice(0, 15).map((e) => [
          e.name || e.id,
          e.browserTimeline.map((t) => shortBrowserName(t.browser, browsers)).join(", "),
          e.missingBrowsers.map((b) => shortBrowserName(b, browsers)).join(", "),
          epochDayToIso(e.first!.day),
          formatDays(e.limboDays),
        ]),
      },
    ],
  };

  // ---------------------------------------------------------------------------
  // Story 5: Platform Velocity — Which Parts of the Web Converge Fastest?
  // ---------------------------------------------------------------------------
  const catTableRows: Array<Array<string | number>> = [];
  const catBars: NonNullable<StoryPayload["bars"]>["items"] = [];

  for (const cat of CATEGORIES) {
    const items = bcdCore3.filter((e) => e.cat === cat && e.first !== null);
    const stableItems = items.filter((e) => e.isStable && e.ageInDays !== null);
    const dist = computeDistribution(stableItems.map((e) => e.ageInDays as number));
    const km = computeKaplanMeier(
      items.map((e) => ({
        timeDays: e.isStable ? (e.ageInDays as number) : (e.limboDays as number),
        event: e.isStable,
      })),
    );
    catTableRows.push([
      CATEGORY_LABELS[cat],
      items.length,
      stableItems.length,
      items.length - stableItems.length,
      formatPct(km.completionRate),
      formatPct(km.probStableBy.d365, false),
      formatDays(km.kmMedianDays),
      formatDays(dist.median),
      formatDays(dist.p90),
    ]);
    catBars.push({
      label: CATEGORY_LABELS[cat],
      value: km.probStableBy.d365 ?? 0,
      secondaryValue: round1(km.completionRate * 100),
      unit: "%",
      detail: `KM median: ${formatDays(km.kmMedianDays)}, ${stableItems.length}/${items.length} stable`,
    });
  }

  const baselineSummary = computeBaselineSummary(webFeatures, manifest);
  const topGroups = baselineSummary.byGroup.slice(0, 15);

  const story5: StoryPayload = {
    slug: "platform-velocity",
    title: "Platform Velocity: Which Parts of the Web Converge Fastest?",
    subtitle:
      "Comparing CSS, JavaScript, HTML, DOM APIs, HTTP, and WebAssembly across Chrome, Firefox, and Safari.",
    categoryTag: "Platform Taxonomy",
    summary:
      "Not every part of the web platform moves at the same speed. Comparing survival rates and medians across BCD top-level specs and WebDX feature groups reveals where consensus forms rapidly versus where specifications fragment.",
    methodology:
      "Computes Core 3 (Chrome, Firefox, Safari) completion rates, Kaplan–Meier 1-year convergence probabilities, and medians across all 6 BCD categories and the largest WebDX groups.",
    keyTakeaways: [
      ...catTableRows.slice(0, 3).map((r) => `${r[0]}: ${r[5]} 1-year KM convergence, ${r[4]} overall completion (${r[2]}/${r[1]} keys).`),
    ],
    metrics: CATEGORIES.slice(0, 4).map((cat) => {
      const row = catTableRows.find((r) => r[0] === CATEGORY_LABELS[cat])!;
      return {
        label: `${CATEGORY_LABELS[cat]} 1y KM%`,
        value: String(row[5]),
        detail: `KM median: ${row[6]}`,
      };
    }),
    bars: {
      title: "1-Year KM Stability Rate & Overall Completion by Specification Area",
      caption: "Primary bar: 1-year KM probability across Core 3 engines. Secondary: overall completion rate.",
      primaryLabel: "1-Year KM %",
      secondaryLabel: "Overall Completion %",
      items: catBars,
    },
    tables: [
      {
        title: "BCD Specification Areas Compared (Core 3 Engines)",
        columns: [
          "Category",
          "Landed",
          "Stable",
          "Waiting",
          "Complete",
          "1y KM %",
          "KM Median",
          "Completed Median",
          "p90",
        ],
        rows: catTableRows,
      },
      {
        title: "Largest WebDX Feature Groups (Baseline & Median TTA)",
        columns: ["WebDX Group", "Features", "Widely Available", "Newly Available", "Limited", "Widely %", "Median TTA"],
        rows: topGroups.map((g) => [
          g.groupName,
          g.total,
          g.high,
          g.low,
          g.limited,
          `${g.widelyPct}%`,
          formatDays(g.medianTtaDays),
        ]),
      },
    ],
  };

  // ---------------------------------------------------------------------------
  // Story 6: Baseline Momentum — Newly Available Waves & What's Next
  // ---------------------------------------------------------------------------
  const story6: StoryPayload = {
    slug: "baseline-momentum",
    title: "Baseline Momentum: Newly Available Waves & What's Next",
    subtitle:
      "Tracking yearly Baseline Newly Available milestones and counting down the next wave of Widely Available features.",
    categoryTag: "Baseline Lifecycle",
    summary:
      "Baseline divides cross-browser stability into Newly Available (interoperable across all 7 core browser targets today) and Widely Available (30 months after reaching Newly Available). Tracking annual waves and upcoming 30-month graduations helps teams plan browser support upgrades.",
    methodology:
      "Uses W3C WebDX web-features Baseline metadata paired with BCD release dates. Widely Available graduation estimates add 913 days (~30 months) to baseline_low_date.",
    keyTakeaways: [
      `${baselineSummary.high} Web Features are Baseline Widely Available, ${baselineSummary.low} are Newly Available, and ${baselineSummary.limited} remain Limited availability.`,
      `${baselineSummary.approachingWidelyAvailable.length} Newly Available features are projected to cross the 30-month Widely Available threshold in the next 6 months.`,
    ],
    metrics: [
      { label: "Widely Available", value: formatNum(baselineSummary.high), detail: `${round1((baselineSummary.high / Math.max(1, baselineSummary.total)) * 100)}% of Web Features` },
      { label: "Newly Available", value: formatNum(baselineSummary.low), detail: "In all 7 core targets (<30m)" },
      { label: "Limited Availability", value: formatNum(baselineSummary.limited), detail: "Missing >=1 core target" },
      { label: "Graduating Soon (≤6m)", value: formatNum(baselineSummary.approachingWidelyAvailable.length), detail: "Entering Widely Available" },
    ],
    bars: {
      title: "Features Reaching Baseline Newly Available Per Year",
      caption: "Annual count of Web Features achieving cross-engine interoperability across all 7 Baseline core browsers.",
      primaryLabel: "Newly Available Count",
      items: baselineSummary.yearlyNewlyAvailable.slice(-12).map((y) => ({
        label: String(y.year),
        value: y.count,
        detail: `Median TTA: ${formatDays(y.medianDays)}`,
      })),
    },
    tables: [
      {
        title: "Approaching Widely Available (Next 6 Months)",
        columns: ["Feature", "Group", "Newly Available", "Projected Widely", "Days Left"],
        rows: baselineSummary.approachingWidelyAvailable.map((a) => [
          a.name,
          a.groupName,
          a.baselineLowDate,
          a.expectedHighDate,
          `${a.daysUntilHigh}d`,
        ]),
      },
      {
        title: "Most Recently Newly Available Features",
        columns: ["Feature", "Group", "Newly Available Date", "Core-7 TTA"],
        rows: baselineSummary.recentNewlyAvailable.slice(0, 15).map((r) => [
          r.name,
          r.groupName,
          r.baselineLowDate,
          formatDays(r.ttaDays),
        ]),
      },
      ...(history.length > 0
        ? [
            {
              title: "Dataset Release History Snapshots",
              columns: ["Date", "BCD Version", "WF Version", "Core-3 Stable (BCD)", "Widely", "Newly"],
              rows: [...history].reverse().slice(0, 15).map((h) => [
                h.date,
                h.bcdVersion,
                h.webFeaturesVersion,
                h.core3StableBcd,
                h.baselineHigh,
                h.baselineLow,
              ]),
            },
          ]
        : []),
    ],
  };

  // ---------------------------------------------------------------------------
  // Story 7: The Web Rarely Forgets — Deprecation vs. Removal
  // ---------------------------------------------------------------------------
  const deprecatedAll = bcdCore3.filter((e) => e.status.deprecated);
  const deprecatedStillEverywhere = deprecatedAll.filter((e) => e.isStable);
  const removedAny = bcdCore3.filter((e) => e.removed !== null);
  const removedAll = bcdCore3.filter((e) => e.removed?.isRemoved === true);
  const removalDist = computeDistribution(removedAll.map((e) => e.removed!.ageInDays));

  const firstRemoverCounts: Record<string, number> = { chrome: 0, firefox: 0, safari: 0 };
  for (const e of removedAll) {
    if (e.removed) firstRemoverCounts[e.removed.first.browser]++;
  }

  const zombiesSorted = [...deprecatedStillEverywhere].sort(
    (a, b) => (a.first?.day ?? 0) - (b.first?.day ?? 0),
  );
  const recentRemoved = [...removedAll].sort(
    (a, b) => (b.removed?.last.day ?? 0) - (a.removed?.last.day ?? 0),
  );

  const story7: StoryPayload = {
    slug: "deprecation-graveyard",
    title: "The Web Rarely Forgets: Deprecation vs. Removal",
    subtitle:
      "Why 'deprecated' on the web usually means 'still supported forever' — comparing deprecated APIs against actual cross-engine removals.",
    categoryTag: "Platform Lifecycle",
    summary:
      "Backward compatibility is the web's defining promise. By comparing every deprecated BCD feature against features that Chrome, Firefox, and Safari actually removed, we can measure how many deprecated APIs remain 'zombies' across all major engines.",
    methodology:
      "Scans all BCD features for status.deprecated vs. active version_removed entries (excluding features that were removed and later re-added). Removal duration measures days between the first and third core engine removing the feature.",
    keyTakeaways: [
      `Out of ${deprecatedAll.length.toLocaleString("en-US")} deprecated BCD APIs, ${deprecatedStillEverywhere.length.toLocaleString("en-US")} (${deprecatedAll.length ? round1((deprecatedStillEverywhere.length / deprecatedAll.length) * 100) : 0}%) are still supported across Chrome, Firefox, and Safari.`,
      `Only ${removedAll.length.toLocaleString("en-US")} BCD keys have been removed across all three core engines, taking a median of ${formatDays(removalDist.median)} from first removal to full removal.`,
    ],
    metrics: [
      { label: "Deprecated APIs", value: formatNum(deprecatedAll.length), detail: "Marked deprecated in BCD" },
      { label: "Zombie APIs", value: formatNum(deprecatedStillEverywhere.length), detail: "Deprecated yet in all 3 engines" },
      { label: "Removed in ≥1 Engine", value: formatNum(removedAny.length), detail: "Active removal recorded" },
      { label: "Fully Removed (All 3)", value: formatNum(removedAll.length), detail: `Median span: ${formatDays(removalDist.median)}` },
    ],
    bars: {
      title: "Lifecycle Funnel: Deprecated vs. Removed Across Core 3 Engines",
      caption: "Comparing total deprecated APIs against APIs still supported everywhere and those fully removed.",
      primaryLabel: "BCD Feature Keys",
      items: [
        { label: "Marked Deprecated", value: deprecatedAll.length },
        { label: "Deprecated & Still in All 3 (Zombie)", value: deprecatedStillEverywhere.length },
        { label: "Removed in ≥1 Engine", value: removedAny.length },
        { label: "Removed in All 3 Engines", value: removedAll.length },
      ],
    },
    tables: [
      {
        title: "Oldest Deprecated 'Zombie' APIs Still in All 3 Core Engines",
        columns: ["API Key", "Category", "First Shipped", "Cross-Engine Stable Date"],
        rows: zombiesSorted.slice(0, 15).map((e) => [
          e.id,
          CATEGORY_LABELS[e.cat],
          e.first ? `${shortBrowserName(e.first.browser, browsers)} (${epochDayToIso(e.first.day)})` : "—",
          e.last ? epochDayToIso(e.last.day) : "—",
        ]),
      },
      {
        title: "Most Recently Fully Removed APIs (All 3 Core Engines)",
        columns: ["API Key", "Category", "First Removed", "Last Removed", "Removal Span"],
        rows: recentRemoved.slice(0, 15).map((e) => [
          e.id,
          CATEGORY_LABELS[e.cat],
          `${shortBrowserName(e.removed!.first.browser, browsers)} (${epochDayToIso(e.removed!.first.day)})`,
          `${shortBrowserName(e.removed!.last.browser, browsers)} (${epochDayToIso(e.removed!.last.day)})`,
          formatDays(e.removed!.ageInDays),
        ]),
      },
    ],
  };

  return [story1, story2, story3, story4, story5, story6, story7];
}
