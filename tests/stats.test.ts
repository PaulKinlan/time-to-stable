import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  computeAnalysisSummary,
  computeCrossTab,
  computeDistribution,
  computeMissingCrossTab,
} from "../src/analysis/stats.ts";
import { isoToEpochDay } from "../src/analysis/support.ts";
import type { FeatureEvaluation, PrecomputedData } from "../src/types.ts";

function makeEval(opts: {
  id: string;
  cat: "api" | "css";
  firstBrowser: string;
  firstDate: string;
  lastBrowser?: string;
  lastDate?: string;
  missing?: string[];
}): FeatureEvaluation {
  const fDay = isoToEpochDay(opts.firstDate);
  const refDay = isoToEpochDay("2025-07-04");
  const isStable = !opts.missing || opts.missing.length === 0;
  const lDay = isStable && opts.lastDate ? isoToEpochDay(opts.lastDate) : null;
  return {
    id: opts.id,
    cat: opts.cat,
    status: { standardTrack: true, experimental: false, deprecated: false },
    browserTimeline: [
      { browser: opts.firstBrowser, version: "1", day: fDay, approx: false },
      ...(isStable && opts.lastBrowser && lDay !== null
        ? [{ browser: opts.lastBrowser, version: "1", day: lDay, approx: false }]
        : []),
    ],
    missingBrowsers: opts.missing ?? [],
    first: { browser: opts.firstBrowser, version: "1", day: fDay },
    last:
      isStable && opts.lastBrowser && lDay !== null
        ? { browser: opts.lastBrowser, version: "1", day: lDay }
        : null,
    isStable,
    ageInDays: isStable && lDay !== null ? lDay - fDay : null,
    limboDays: !isStable ? refDay - fDay : null,
    removed: null,
    hasCaveat: false,
  };
}

describe("stats calculations", () => {
  it("computes quantiles and buckets cleanly without NaN on empty or skewed sets", () => {
    const empty = computeDistribution([]);
    assert.equal(empty.count, 0);
    assert.equal(empty.median, null);
    assert.equal(empty.mean, null);

    const skewed = computeDistribution([0, 10, 20, 100, 1000]);
    assert.equal(skewed.count, 5);
    assert.equal(skewed.median, 20);
    assert.equal(skewed.p25, 10);
    assert.equal(skewed.p75, 100);
    assert.equal(skewed.iqr, 90);
    assert.equal(skewed.fastFollowPct, 60);
    const totalBucketCount = skewed.buckets.reduce((s, b) => s + b.count, 0);
    assert.equal(totalBucketCount, 5);
  });

  it("initializes all cells in sparse cross-tabs to zero and computes yearly censoring", () => {
    const evals: FeatureEvaluation[] = [
      makeEval({
        id: "css.a",
        cat: "css",
        firstBrowser: "chrome",
        firstDate: "2020-01-01",
        lastBrowser: "safari",
        lastDate: "2020-03-01",
      }),
      makeEval({
        id: "css.b",
        cat: "css",
        firstBrowser: "chrome",
        firstDate: "2024-01-01",
        missing: ["firefox", "safari"],
      }),
    ];

    const cross = computeCrossTab(evals, ["chrome", "firefox", "safari"]);
    assert.equal(cross.matrix.firefox.chrome, 0);
    assert.equal(cross.matrix.chrome.safari, 1);
    assert.equal(cross.total, 1);

    const missing = computeMissingCrossTab(evals, ["chrome", "firefox", "safari"]);
    assert.equal(missing.matrix.chrome.firefox, 1);
    assert.equal(missing.matrix.chrome.safari, 1);
    assert.equal(missing.rowTotals.chrome, 1);
    assert.equal(missing.colTotals.firefox, 1);

    const summary = computeAnalysisSummary(
      evals,
      ["chrome", "firefox", "safari"],
      ["css"],
    );
    assert.equal(summary.yearlyCohorts.length, 2);
    assert.equal(summary.yearlyCohorts[0].year, 2020);
    assert.equal(summary.yearlyCohorts[0].isRightCensored, false);
    assert.equal(summary.yearlyCohorts[1].year, 2024);
    assert.equal(summary.yearlyCohorts[1].isRightCensored, true);
    assert.equal(summary.yearlyCohorts[1].medianDays, null);
  });

  it("compiled precomputed.json contains all 7 stories with metrics and tables", () => {
    const prePath = path.resolve("public/data/precomputed.json");
    const pre = JSON.parse(fs.readFileSync(prePath, "utf8")) as PrecomputedData;
    const expectedSlugs = [
      "is-the-web-getting-faster",
      "the-lumpy-web",
      "mobile-parity-gap",
      "the-long-tail",
      "platform-velocity",
      "baseline-momentum",
      "deprecation-graveyard",
    ];
    assert.deepEqual(
      pre.stories.map((s) => s.slug),
      expectedSlugs,
    );
    for (const story of pre.stories) {
      assert.ok(story.metrics.length >= 3, `${story.slug} missing metrics`);
      assert.ok(story.keyTakeaways.length >= 2, `${story.slug} missing takeaways`);
      assert.ok(story.tables.length >= 1, `${story.slug} missing tables`);
    }
  });
});
