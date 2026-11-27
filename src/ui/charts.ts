import { epochDayToIso } from "../analysis/support.ts";
import { escapeHtml } from "../formats/html.ts";
import type {
  BaselineSummary,
  BrowserMeta,
  BrowserPoint,
  BrowserShareRow,
  DistributionStats,
  StoryChartSeries,
  StoryPayload,
  TimelinePoint,
  YearlyCohortRow,
} from "../types.ts";

const COLOR_MAP = {
  primary: "var(--chart-1)",
  secondary: "var(--chart-2)",
  tertiary: "var(--chart-3)",
  quaternary: "var(--chart-4)",
};

export function renderDistributionHistogram(
  dist: DistributionStats,
  title = "Time-to-Stable Distribution",
): string {
  if (dist.count === 0) return "";

  const width = 560;
  const height = 240;
  const padL = 115;
  const padR = 64;
  const padT = 16;
  const padB = 22;
  const innerW = width - padL - padR;
  const maxPct = Math.max(10, ...dist.buckets.map((b) => b.pct));
  const rowH = (height - padT - padB) / dist.buckets.length;

  const bars = dist.buckets
    .map((b, i) => {
      const y = padT + i * rowH + 4;
      const bh = Math.max(12, rowH - 8);
      const bw = Math.max(2, (b.pct / maxPct) * innerW);
      const tip = `${b.label}: ${b.count.toLocaleString("en-US")} features (${b.pct}%)`;
      return `<g data-tooltip="${escapeHtml(tip)}">
      <text x="${padL - 8}" y="${y + bh / 2 + 4}" text-anchor="end" class="svg-label">${escapeHtml(b.label)}</text>
      <rect x="${padL}" y="${y}" width="${bw.toFixed(1)}" height="${bh}" rx="3" fill="var(--chart-1)" opacity="0.88"/>
      <text x="${(padL + bw + 6).toFixed(1)}" y="${y + bh / 2 + 4}" class="svg-value">${b.pct}% (${b.count.toLocaleString("en-US")})</text>
    </g>`;
    })
    .join("");

  return `<figure class="chart-card">
  <h3>${escapeHtml(title)}</h3>
  <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    ${bars}
  </svg>
  <figcaption>Median ${dist.median ?? "—"}d · IQR ${dist.iqr ?? "—"}d · p90 ${dist.p90 ?? "—"}d · Fast-follow (≤30d): ${dist.fastFollowPct ?? "—"}%</figcaption>
</figure>`;
}

export function renderYearlyCohortChart(
  cohorts: readonly YearlyCohortRow[],
  title = "Yearly Cohort Median TTA & Completion Rate",
): string {
  const recent = cohorts.slice(-14);
  if (recent.length === 0) return "";

  const width = 580;
  const height = 250;
  const padL = 44;
  const padR = 40;
  const padT = 18;
  const padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const maxMed = Math.max(
    180,
    ...recent.map((c) => c.medianDays ?? 0),
  );
  const slotW = innerW / recent.length;
  const barW = Math.max(8, slotW * 0.56);

  const gridLines = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = padT + innerH * (1 - f);
      const val = Math.round(maxMed * f);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" class="svg-grid"/>
      <text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="svg-label">${val}d</text>`;
    })
    .join("");

  const bars = recent
    .map((c, i) => {
      const x = padL + i * slotW + (slotW - barW) / 2;
      const med = c.medianDays ?? 0;
      const h = (med / maxMed) * innerH;
      const y = padT + innerH - h;
      const fill = c.isRightCensored ? "var(--chart-3)" : "var(--chart-1)";
      const tip = `${c.year}: Median ${c.medianDays ?? "—"}d, ${Math.round(c.completionRate * 100)}% stable (${c.stableCount}/${c.totalLanded})${c.isRightCensored ? " — right-censored" : ""}`;
      return `<g data-tooltip="${escapeHtml(tip)}">
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2" fill="${fill}" opacity="0.82"/>
      <text x="${(x + barW / 2).toFixed(1)}" y="${height - 14}" text-anchor="middle" class="svg-label">${String(c.year).slice(-2)}</text>
    </g>`;
    })
    .join("");

  // Overlay completion % polyline (0-100%)
  const compPoints = recent
    .map((c, i) => {
      const cx = padL + i * slotW + slotW / 2;
      const cy = padT + innerH * (1 - c.completionRate);
      return `${cx.toFixed(1)},${cy.toFixed(1)}`;
    })
    .join(" ");

  const compDots = recent
    .map((c, i) => {
      const cx = padL + i * slotW + slotW / 2;
      const cy = padT + innerH * (1 - c.completionRate);
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.2" fill="var(--chart-2)" stroke="var(--surface)" stroke-width="1"/>`;
    })
    .join("");

  return `<figure class="chart-card">
  <h3>${escapeHtml(title)}</h3>
  <div class="svg-legend">
    <span><span class="legend-dot" style="--dot:var(--chart-1)"></span>Median TTA (Mature ≥80%)</span>
    <span><span class="legend-dot" style="--dot:var(--chart-3)"></span>Median TTA (Right-censored &lt;80%)</span>
    <span><span class="legend-dot" style="--dot:var(--chart-2)"></span>Completion % (right axis)</span>
  </div>
  <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    ${gridLines}
    <text x="${width - padR + 6}" y="${padT + 4}" class="svg-label">100%</text>
    <text x="${width - padR + 6}" y="${padT + innerH / 2 + 4}" class="svg-label">50%</text>
    <text x="${width - padR + 6}" y="${padT + innerH + 4}" class="svg-label">0%</text>
    ${bars}
    <polyline fill="none" stroke="var(--chart-2)" stroke-width="2.2" points="${compPoints}"/>
    ${compDots}
  </svg>
  <figcaption>Bars show completed-feature median days; green line shows cohort completion rate. Amber bars have &lt;80% completion and underestimate true wait times.</figcaption>
</figure>`;
}

export function renderBrowserShareChart(
  share: readonly BrowserShareRow[],
  browsers: readonly BrowserMeta[],
  title = "Sprinters (First-In) vs. Plodders (Last-In)",
): string {
  if (share.length === 0) return "";
  const width = 560;
  const rowH = 38;
  const padL = 115;
  const padR = 52;
  const padT = 16;
  const height = padT + share.length * rowH + 16;
  const innerW = width - padL - padR;

  const rows = share
    .map((r, i) => {
      const name = browsers.find((b) => b.id === r.browser)?.shortName ?? r.browser;
      const y = padT + i * rowH;
      const w1 = (r.firstPct / 100) * innerW;
      const w2 = (r.lastPct / 100) * innerW;
      const tip = `${name}: First-in ${r.firstCount} (${r.firstPct}%, med ${r.firstMedianDays ?? "—"}d) · Last-in ${r.lastCount} (${r.lastPct}%, med ${r.lastMedianDays ?? "—"}d)`;
      return `<g data-tooltip="${escapeHtml(tip)}">
      <text x="${padL - 8}" y="${y + 18}" text-anchor="end" class="svg-label">${escapeHtml(name)}</text>
      <rect x="${padL}" y="${y + 4}" width="${Math.max(2, w1).toFixed(1)}" height="11" rx="2" fill="var(--chart-2)"/>
      <text x="${(padL + Math.max(2, w1) + 5).toFixed(1)}" y="${y + 13}" class="svg-label">${r.firstPct}%</text>
      <rect x="${padL}" y="${y + 18}" width="${Math.max(2, w2).toFixed(1)}" height="11" rx="2" fill="var(--chart-1)"/>
      <text x="${(padL + Math.max(2, w2) + 5).toFixed(1)}" y="${y + 27}" class="svg-label">${r.lastPct}%</text>
    </g>`;
    })
    .join("");

  return `<figure class="chart-card">
  <h3>${escapeHtml(title)}</h3>
  <div class="svg-legend">
    <span><span class="legend-dot" style="--dot:var(--chart-2)"></span>First to ship (Sprinter %)</span>
    <span><span class="legend-dot" style="--dot:var(--chart-1)"></span>Last to ship (Plodder %)</span>
  </div>
  <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    ${rows}
  </svg>
  <figcaption>Share of cross-browser stable features where each browser shipped earliest vs. latest.</figcaption>
</figure>`;
}

export function renderSurvivalCurvesChart(
  curves: readonly StoryChartSeries[],
  title = "Kaplan–Meier Convergence Curves",
  caption = "Probability (%) of reaching full 3-engine stability over days since first browser launch.",
): string {
  if (curves.length === 0) return "";
  const width = 680;
  const height = 280;
  const padL = 44;
  const padR = 24;
  const padT = 18;
  const padB = 36;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const maxDay = 1825; // 5 years horizon

  const xTicks = [0, 180, 365, 730, 1095, 1460, 1825];
  const grid = [0, 25, 50, 75, 100]
    .map((pct) => {
      const y = padT + innerH * (1 - pct / 100);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" class="svg-grid"/>
      <text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="svg-label">${pct}%</text>`;
    })
    .join("");

  const xAxisTicks = xTicks
    .map((d) => {
      const x = padL + (d / maxDay) * innerW;
      const label = d === 0 ? "0d" : d < 365 ? `${d}d` : `${Math.round(d / 365)}y`;
      return `<text x="${x.toFixed(1)}" y="${height - 14}" text-anchor="middle" class="svg-label">${label}</text>`;
    })
    .join("");

  const lines = curves
    .map((series) => {
      const color = COLOR_MAP[series.colorKey];
      const filtered = series.points.filter((p) => p.x <= maxDay);
      if (filtered.length === 0) return "";
      const pts = filtered
        .map((p) => {
          const x = padL + (p.x / maxDay) * innerW;
          const y = padT + innerH * (1 - p.y / 100);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ");
      const dots = filtered
        .map((p) => {
          const x = padL + (p.x / maxDay) * innerW;
          const y = padT + innerH * (1 - p.y / 100);
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${color}" data-tooltip="${escapeHtml(p.label ?? `${series.label}: ${p.y}%`)}"/>`;
        })
        .join("");
      return `<polyline fill="none" stroke="${color}" stroke-width="2.4" points="${pts}"/>${dots}`;
    })
    .join("");

  const legend = curves
    .map(
      (s) =>
        `<span><span class="legend-dot" style="--dot:${COLOR_MAP[s.colorKey]}"></span>${escapeHtml(s.label)}</span>`,
    )
    .join("");

  return `<figure class="chart-card">
  <h3>${escapeHtml(title)}</h3>
  <div class="svg-legend">${legend}</div>
  <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    ${grid}
    ${xAxisTicks}
    ${lines}
  </svg>
  <figcaption>${escapeHtml(caption)}</figcaption>
</figure>`;
}

export function renderGenericBarsChart(
  bars: NonNullable<StoryPayload["bars"]>,
): string {
  if (bars.items.length === 0) return "";
  const width = 660;
  const hasSecondary = bars.items.some((i) => i.secondaryValue !== undefined);
  const rowH = hasSecondary ? 36 : 28;
  const padL = 175;
  const padR = 72;
  const padT = 14;
  const height = padT + bars.items.length * rowH + 14;
  const innerW = width - padL - padR;

  const maxVal = Math.max(
    1,
    ...bars.items.flatMap((i) => [i.value, i.secondaryValue ?? 0]),
  );

  const unit = bars.items[0]?.unit ?? "";
  const rows = bars.items
    .map((item, idx) => {
      const y = padT + idx * rowH;
      const w1 = Math.max(2, (item.value / maxVal) * innerW);
      const tip = `${item.label}: ${item.value}${unit}${item.secondaryValue !== undefined ? ` / ${item.secondaryValue}${unit}` : ""}${item.detail ? ` (${item.detail})` : ""}`;
      if (hasSecondary && item.secondaryValue !== undefined) {
        const w2 = Math.max(2, (item.secondaryValue / maxVal) * innerW);
        return `<g data-tooltip="${escapeHtml(tip)}">
        <text x="${padL - 8}" y="${y + 18}" text-anchor="end" class="svg-label">${escapeHtml(item.label)}</text>
        <rect x="${padL}" y="${y + 4}" width="${w1.toFixed(1)}" height="11" rx="2" fill="var(--chart-1)"/>
        <text x="${(padL + w1 + 5).toFixed(1)}" y="${y + 13}" class="svg-label">${item.value}${escapeHtml(unit)}</text>
        <rect x="${padL}" y="${y + 18}" width="${w2.toFixed(1)}" height="11" rx="2" fill="var(--chart-2)"/>
        <text x="${(padL + w2 + 5).toFixed(1)}" y="${y + 27}" class="svg-label">${item.secondaryValue}${escapeHtml(unit)}</text>
      </g>`;
      }
      return `<g data-tooltip="${escapeHtml(tip)}">
      <text x="${padL - 8}" y="${y + 15}" text-anchor="end" class="svg-label">${escapeHtml(item.label)}</text>
      <rect x="${padL}" y="${y + 4}" width="${w1.toFixed(1)}" height="15" rx="2" fill="var(--chart-1)"/>
      <text x="${(padL + w1 + 6).toFixed(1)}" y="${y + 15}" class="svg-value">${item.value}${escapeHtml(unit)}</text>
    </g>`;
    })
    .join("");

  return `<figure class="chart-card">
  <h3>${escapeHtml(bars.title)}</h3>
  <div class="svg-legend">
    <span><span class="legend-dot" style="--dot:var(--chart-1)"></span>${escapeHtml(bars.primaryLabel)}</span>
    ${bars.secondaryLabel ? `<span><span class="legend-dot" style="--dot:var(--chart-2)"></span>${escapeHtml(bars.secondaryLabel)}</span>` : ""}
  </div>
  <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(bars.title)}">
    ${rows}
  </svg>
  <figcaption>${escapeHtml(bars.caption)}</figcaption>
</figure>`;
}

export function renderBaselineTrendChart(summary: BaselineSummary): string {
  const recent = summary.yearlyNewlyAvailable.slice(-12);
  if (recent.length === 0) return "";
  return renderGenericBarsChart({
    title: "Baseline Newly Available Features Per Year",
    caption: "Annual count of Web Features achieving cross-engine interoperability across all 7 Baseline core browsers.",
    primaryLabel: "Features",
    items: recent.map((y) => ({
      label: String(y.year),
      value: y.count,
      detail: y.medianDays !== null ? `Median TTA ${y.medianDays}d` : undefined,
    })),
  });
}

export function renderFeatureTimelineSvg(
  timeline: readonly TimelinePoint[],
  browsers: readonly BrowserMeta[],
  title = "Browser Support Timeline",
): string {
  if (timeline.length === 0) return "";
  const width = 660;
  const rowH = 26;
  const padL = 135;
  const padR = 110;
  const padT = 18;
  const padB = 26;
  const height = padT + timeline.length * rowH + padB;
  const innerW = width - padL - padR;

  const minDay = timeline[0].day;
  const maxDay = Math.max(minDay + 1, timeline[timeline.length - 1].day);

  const rows = timeline
    .map((pt, i) => {
      const name = browsers.find((b) => b.id === pt.browser)?.name ?? pt.browser;
      const y = padT + i * rowH;
      const cx = padL + ((pt.day - minDay) / (maxDay - minDay)) * innerW;
      const dateStr = epochDayToIso(pt.day);
      const delta = pt.day - minDay;
      const tip = `${name} ${pt.version} (${dateStr}, +${delta}d)`;
      return `<g data-tooltip="${escapeHtml(tip)}">
      <text x="${padL - 8}" y="${y + 14}" text-anchor="end" class="svg-label">${escapeHtml(name)}</text>
      <line x1="${padL}" y1="${y + 10}" x2="${cx.toFixed(1)}" y2="${y + 10}" stroke="var(--chart-1)" stroke-width="2" opacity="0.5"/>
      <circle cx="${cx.toFixed(1)}" cy="${y + 10}" r="5" fill="${i === 0 ? "var(--chart-2)" : "var(--chart-1)"}"/>
      <text x="${(cx + 9).toFixed(1)}" y="${y + 14}" class="svg-value">v${escapeHtml(pt.version)} (${dateStr})</text>
    </g>`;
    })
    .join("");

  return `<figure class="chart-card">
  <h3>${escapeHtml(title)}</h3>
  <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
    ${rows}
  </svg>
  <figcaption>Green dot marks the first browser release (${epochDayToIso(minDay)}); blue dots show subsequent browser launches (+${maxDay - minDay}d total span).</figcaption>
</figure>`;
}

export function renderTimelineSummaryLine(
  first: BrowserPoint | null,
  last: BrowserPoint | null,
): string {
  if (!first) return "—";
  if (!last || first.browser === last.browser) {
    return `${first.browser} (${epochDayToIso(first.day)})`;
  }
  return `${first.browser} (${epochDayToIso(first.day)}) → ${last.browser} (${epochDayToIso(last.day)})`;
}
