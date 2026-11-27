import { CATEGORY_LABELS } from "../analysis/query.ts";
import { epochDayToIso } from "../analysis/support.ts";
import type {
  BrowserMeta,
  CompactFeatureRowSnapshot,
  CompactWebFeature,
  ViewKind,
} from "../types.ts";

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function serializeCsv(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  const lines: string[] = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function csvResponse(
  filename: string,
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
  status = 200,
): Response {
  const safeName = filename.replace(/[^a-z0-9._-]/gi, "-");
  return new Response(serializeCsv(headers, rows), {
    status,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${safeName}"`,
    },
  });
}

function browserName(id: string, browsers: readonly BrowserMeta[]): string {
  return browsers.find((b) => b.id === id)?.name ?? id;
}

export function buildFeatureRowsCsv(
  view: ViewKind,
  rows: readonly CompactFeatureRowSnapshot[],
  browsers: readonly BrowserMeta[],
  selectedBrowsers: readonly string[],
): {
  filename: string;
  headers: string[];
  csvRows: Array<Array<string | number | null>>;
} {
  if (view === "not-stable") {
    return {
      filename: "not-yet-stable.csv",
      headers: [
        "Feature",
        "Category",
        "First Browser",
        "First Date",
        "Days in Limbo",
        "Present In",
        "Missing In",
        "Baseline",
        "MDN URL",
      ],
      csvRows: rows.map((r) => [
        r.name ? `${r.name} (${r.id})` : r.id,
        CATEGORY_LABELS[r.cat],
        r.first ? browserName(r.first.browser, browsers) : "",
        r.first ? epochDayToIso(r.first.day) : "",
        r.limboDays ?? "",
        r.browserTimeline.map((t) => `${browserName(t.browser, browsers)} ${t.version}`).join("; "),
        r.missingBrowsers.map((b) => browserName(b, browsers)).join("; "),
        r.baseline === "high" ? "widely" : r.baseline === "low" ? "newly" : "limited",
        r.mdnUrl ?? "",
      ]),
    };
  }

  if (view === "all") {
    const headers = [
      "Feature",
      "Category",
      "Baseline",
      "Stable Across Selected",
      "Days to Stable",
      ...selectedBrowsers.map((b) => `${browserName(b, browsers)} Version`),
      ...selectedBrowsers.map((b) => `${browserName(b, browsers)} Date`),
      "MDN URL",
    ];
    return {
      filename: "all-features.csv",
      headers,
      csvRows: rows.map((r) => {
        const byBrowser = new Map(r.browserTimeline.map((t) => [t.browser, t]));
        return [
          r.name ? `${r.name} (${r.id})` : r.id,
          CATEGORY_LABELS[r.cat],
          r.baseline === "high" ? "widely" : r.baseline === "low" ? "newly" : "limited",
          r.isStable ? "true" : "false",
          r.ageInDays ?? "",
          ...selectedBrowsers.map((b) => byBrowser.get(b)?.version ?? ""),
          ...selectedBrowsers.map((b) => {
            const pt = byBrowser.get(b);
            return pt ? epochDayToIso(pt.day) : "";
          }),
          r.mdnUrl ?? "",
        ];
      }),
    };
  }

  return {
    filename: `${view}.csv`,
    headers: [
      "Feature",
      "Category",
      "First Browser",
      "First Version",
      "First Date",
      "Last Browser",
      "Last Version",
      "Last Date",
      "Days",
      "Baseline",
      "MDN URL",
    ],
    csvRows: rows.map((r) => [
      r.name ? `${r.name} (${r.id})` : r.id,
      CATEGORY_LABELS[r.cat],
      r.first ? browserName(r.first.browser, browsers) : "",
      r.first?.version ?? "",
      r.first ? epochDayToIso(r.first.day) : "",
      r.last ? browserName(r.last.browser, browsers) : "",
      r.last?.version ?? "",
      r.last ? epochDayToIso(r.last.day) : "",
      r.ageInDays ?? r.limboDays ?? "",
      r.baseline === "high" ? "widely" : r.baseline === "low" ? "newly" : "limited",
      r.mdnUrl ?? "",
    ]),
  };
}

export function buildBaselineCsv(
  features: readonly CompactWebFeature[],
): {
  filename: string;
  headers: string[];
  csvRows: Array<Array<string | number | null>>;
} {
  return {
    filename: "baseline-web-features.csv",
    headers: [
      "ID",
      "Name",
      "Group",
      "Baseline",
      "Newly Available Date",
      "Widely Available Date",
      "BCD Keys",
      "Spec URL",
    ],
    csvRows: features.map((f) => [
      f.id,
      f.name,
      f.groupName,
      f.baseline === "high" ? "widely" : f.baseline === "low" ? "newly" : "limited",
      f.baselineLowDate ?? "",
      f.baselineHighDate ?? "",
      f.compatCount,
      f.spec ?? "",
    ]),
  };
}
