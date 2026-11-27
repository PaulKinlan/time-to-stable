import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeKaplanMeier } from "../src/analysis/survival.ts";

describe("computeKaplanMeier", () => {
  it("handles empty observations cleanly without NaN", () => {
    const res = computeKaplanMeier([]);
    assert.equal(res.n, 0);
    assert.equal(res.events, 0);
    assert.equal(res.censored, 0);
    assert.equal(res.completionRate, 0);
    assert.equal(res.kmMedianDays, null);
    assert.equal(res.probStableBy.d365, null);
    assert.deepEqual(res.curve, []);
  });

  it("computes exact probabilities when all features converge", () => {
    // 4 events at days 0, 100, 300, 500
    const res = computeKaplanMeier([
      { timeDays: 0, event: true },
      { timeDays: 100, event: true },
      { timeDays: 300, event: true },
      { timeDays: 500, event: true },
    ]);
    assert.equal(res.n, 4);
    assert.equal(res.events, 4);
    assert.equal(res.censored, 0);
    assert.equal(res.completionRate, 1);
    // S(0)=0.75, S(100)=0.50 -> median=100
    assert.equal(res.kmMedianDays, 100);
    assert.equal(res.probStableBy.d30, 25);
    assert.equal(res.probStableBy.d180, 50);
    assert.equal(res.probStableBy.d365, 75);
    assert.equal(res.probStableBy.d730, 100);
  });

  it("handles right-censoring and ties accurately", () => {
    // At t=100: n=4, d=1, c=1 -> S(100)=1*(1 - 1/4)=0.75; atRisk becomes 2
    // At t=300: n=2, d=1, c=0 -> S(300)=0.75*(1 - 1/2)=0.375; probStable=62.5%
    // At t=400: n=1, d=0, c=1 -> S remains 0.375 (>0)
    const res = computeKaplanMeier([
      { timeDays: 100, event: true },
      { timeDays: 100, event: false },
      { timeDays: 300, event: true },
      { timeDays: 400, event: false },
    ]);
    assert.equal(res.n, 4);
    assert.equal(res.events, 2);
    assert.equal(res.censored, 2);
    assert.equal(res.completionRate, 0.5);
    assert.equal(res.kmMedianDays, 300);
    assert.equal(res.probStableBy.d180, 25);
    assert.equal(res.probStableBy.d365, 62.5);
    // Beyond maxObservedTime (400d) with S>0 must return null rather than extrapolate
    assert.equal(res.probStableBy.d730, null);
    assert.equal(res.probStableBy.d1825, null);
  });

  it("returns null kmMedianDays when fewer than half ever stabilize", () => {
    const res = computeKaplanMeier([
      { timeDays: 50, event: true },
      { timeDays: 200, event: false },
      { timeDays: 300, event: false },
      { timeDays: 400, event: false },
    ]);
    assert.equal(res.kmMedianDays, null);
    assert.equal(res.probStableBy.d365, 25);
  });
});
