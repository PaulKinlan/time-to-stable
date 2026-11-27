import type { SurvivalPoint, SurvivalSummary } from "../types.ts";

export interface SurvivalObservation {
  timeDays: number;
  event: boolean;
}

const CURVE_DAYS = [
  0, 7, 14, 30, 60, 90, 180, 270, 365, 548, 730, 1095, 1460, 1825, 2555, 3650,
];

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

/**
 * Computes a right-censored Kaplan-Meier survival estimate for time-to-stability.
 * Events represent features that achieved support across all selected browsers;
 * censored observations represent features that landed in at least one browser
 * and are still waiting as of the dataset reference date.
 */
export function computeKaplanMeier(
  observations: readonly SurvivalObservation[],
): SurvivalSummary {
  const n = observations.length;
  if (n === 0) {
    return {
      n: 0,
      events: 0,
      censored: 0,
      completionRate: 0,
      probStableBy: {
        d30: null,
        d90: null,
        d180: null,
        d365: null,
        d730: null,
        d1825: null,
      },
      kmMedianDays: null,
      curve: [],
    };
  }

  const sorted = observations
    .map((o) => ({
      timeDays: Math.max(0, Math.round(o.timeDays)),
      event: o.event,
    }))
    .sort((a, b) => a.timeDays - b.timeDays);

  let atRisk = n;
  let survival = 1.0;
  let events = 0;
  let censored = 0;
  let kmMedianDays: number | null = null;
  let maxObservedTime = 0;

  // Store step transitions: [time, survivalAfterTime]
  const steps: Array<{ t: number; s: number }> = [];

  let i = 0;
  while (i < sorted.length) {
    const t = sorted[i].timeDays;
    if (t > maxObservedTime) maxObservedTime = t;
    let d = 0;
    let c = 0;
    while (i < sorted.length && sorted[i].timeDays === t) {
      if (sorted[i].event) d++;
      else c++;
      i++;
    }
    events += d;
    censored += c;
    if (d > 0 && atRisk > 0) {
      survival *= 1 - d / atRisk;
      if (survival < 1e-12) survival = 0;
      steps.push({ t, s: survival });
      if (kmMedianDays === null && survival <= 0.5) {
        kmMedianDays = t;
      }
    }
    atRisk -= d + c;
  }

  const survivalAt = (targetDay: number): number | null => {
    if (targetDay > maxObservedTime && survival > 0) {
      return null;
    }
    let s = 1.0;
    for (const step of steps) {
      if (step.t <= targetDay) s = step.s;
      else break;
    }
    return round1(100 * (1 - s));
  };

  const curve: SurvivalPoint[] = [];
  for (const day of CURVE_DAYS) {
    if (day > maxObservedTime) break;
    const pct = survivalAt(day);
    if (pct !== null) {
      curve.push({ day, pctStable: pct });
    }
  }
  if (
    maxObservedTime > 0 &&
    (curve.length === 0 || curve[curve.length - 1].day !== maxObservedTime)
  ) {
    const endPct = survivalAt(maxObservedTime);
    if (endPct !== null) {
      curve.push({ day: maxObservedTime, pctStable: endPct });
    }
  }

  return {
    n,
    events,
    censored,
    completionRate: n > 0 ? round1((events / n) * 100) / 100 : 0,
    probStableBy: {
      d30: survivalAt(30),
      d90: survivalAt(90),
      d180: survivalAt(180),
      d365: survivalAt(365),
      d730: survivalAt(730),
      d1825: survivalAt(1825),
    },
    kmMedianDays,
    curve,
  };
}
