import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SUPPORT_OPTIONS,
  evaluateFeatureSupport,
  evaluateWebFeatureSupport,
  isoToEpochDay,
} from "../src/analysis/support.ts";
import type { CompactFeature, CompactWebFeature } from "../src/types.ts";

const REF_DAY = isoToEpochDay("2025-07-04");

describe("evaluateFeatureSupport", () => {
  it("evaluates strict vs caveat support toggles accurately", () => {
    const feat: CompactFeature = {
      id: "api.TestFeature",
      cat: "api",
      st: 1,
      s: {
        chrome: { v: "100", d: isoToEpochDay("2022-04-01") },
        firefox: { p: ["105", isoToEpochDay("2022-09-20")] },
        safari: { x: ["16", isoToEpochDay("2022-09-12")] },
        edge: { f: ["101", isoToEpochDay("2022-05-01")] },
      },
    };

    // Default: partial included (firefox), prefixed/flagged excluded (safari, edge)
    const def = evaluateFeatureSupport(
      feat,
      ["chrome", "firefox", "safari"],
      DEFAULT_SUPPORT_OPTIONS,
      REF_DAY,
    );
    assert.equal(def.isStable, false);
    assert.equal(def.hasCaveat, true);
    assert.deepEqual(def.missingBrowsers, ["safari"]);
    assert.equal(def.browserTimeline.length, 2);

    // Exclude partial -> firefox is now missing too
    const strict = evaluateFeatureSupport(
      feat,
      ["chrome", "firefox"],
      { excludePartial: true, includePrefixed: false, includeFlagged: false },
      REF_DAY,
    );
    assert.equal(strict.isStable, false);
    assert.deepEqual(strict.missingBrowsers, ["firefox"]);

    // Include prefixed -> chrome, firefox (partial), safari (prefixed) all present
    const withPrefixed = evaluateFeatureSupport(
      feat,
      ["chrome", "firefox", "safari"],
      { excludePartial: false, includePrefixed: true, includeFlagged: false },
      REF_DAY,
    );
    assert.equal(withPrefixed.isStable, true);
    assert.equal(withPrefixed.first?.browser, "chrome");
    assert.equal(withPrefixed.last?.browser, "firefox");
    assert.equal(
      withPrefixed.ageInDays,
      isoToEpochDay("2022-09-20") - isoToEpochDay("2022-04-01"),
    );

    // Include flagged -> edge also qualifies
    const withFlagged = evaluateFeatureSupport(
      feat,
      ["chrome", "edge"],
      { excludePartial: false, includePrefixed: false, includeFlagged: true },
      REF_DAY,
    );
    assert.equal(withFlagged.isStable, true);
    assert.equal(withFlagged.ageInDays, 30);
  });

  it("computes removed duration from firstRemoved to lastRemoved (not Date.now())", () => {
    const removedFeat: CompactFeature = {
      id: "api.OldDeadFeature",
      cat: "api",
      st: 4,
      s: {
        chrome: { rv: "80", rd: isoToEpochDay("2020-02-04") },
        firefox: { rv: "90", rd: isoToEpochDay("2021-07-13") },
      },
    };
    const ev = evaluateFeatureSupport(
      removedFeat,
      ["chrome", "firefox"],
      DEFAULT_SUPPORT_OPTIONS,
      REF_DAY,
    );
    assert.ok(ev.removed);
    assert.equal(ev.removed.isRemoved, true);
    assert.equal(ev.removed.first.browser, "chrome");
    assert.equal(ev.removed.last.browser, "firefox");
    assert.equal(
      ev.removed.ageInDays,
      isoToEpochDay("2021-07-13") - isoToEpochDay("2020-02-04"),
    );
  });

  it("evaluates web-features support deterministically", () => {
    const wf: CompactWebFeature = {
      id: "subgrid",
      name: "Subgrid",
      description: "CSS grid subgrid",
      group: "grid",
      groupName: "Grid",
      baseline: "low",
      baselineLowDate: "2023-09-15",
      baselineLowDay: isoToEpochDay("2023-09-15"),
      compatCount: 2,
      cats: ["css"],
      compatKeysSample: ["css.properties.grid-template-columns.subgrid"],
      s: {
        firefox: { v: "71", d: isoToEpochDay("2019-12-03") },
        safari: { v: "16", d: isoToEpochDay("2022-09-12") },
        chrome: { v: "117", d: isoToEpochDay("2023-09-12") },
      },
    };

    const ev = evaluateWebFeatureSupport(wf, ["chrome", "firefox", "safari"], REF_DAY);
    assert.equal(ev.isStable, true);
    assert.equal(ev.first?.browser, "firefox");
    assert.equal(ev.last?.browser, "chrome");
    assert.equal(
      ev.ageInDays,
      isoToEpochDay("2023-09-12") - isoToEpochDay("2019-12-03"),
    );
  });
});
