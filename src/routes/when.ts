
import { getStableFeatures } from "../bcd.ts";
import { default as Browsers } from "../browser.ts";
import { CompatData } from "../types.d.ts";
import { parseResponse, parseSelectedBrowsers, parseSelectedFeatures } from "./_utils/request.ts";
import { FeatureConfig, WhenRender } from "./types.d.ts";

import htmlRender from './when/html.ts';
import rssRender from './when/rss.ts';
import csvRender from './when/csv.ts';

const controllers = {
  'csv': csvRender,
  'html': htmlRender,
  'rss': rssRender
};

const featureConfig: FeatureConfig = { 'api': { name: "DOM API" }, 'css': { name: "CSS" }, 'html': { name: "HTML" }, 'http': { name: "HTTP" }, 'javascript': { name: "JS" }, 'webassembly': { name: "WebAssembly" } };

export default function render(request: Request, bcd: CompatData): Response {
  const url = new URL(request.url);
  const { __meta, browsers } = bcd;

  const warnings = new Array<string>();
  const helper = new Browsers(browsers);

  const selectedBrowsers = parseSelectedBrowsers(request);
  const selectedFeatures = parseSelectedFeatures(request);

  const responseType = parseResponse(request);

  const submitted = url.href.indexOf("?") > -1; // Likely submitted from form with nothing selected.

  if (selectedBrowsers.size < 2 && submitted) {
    warnings.push("Choose at least two browsers to compare");
  }

  if (selectedFeatures.size < 1 && submitted) {
    warnings.push("Choose at least one feature to show");
  }

  // only show the features selected.
  const filteredData = Object.fromEntries(
    Object.entries(bcd).filter(([key]) => selectedFeatures.has(key)),
  );

  const features = getStableFeatures(
    browsers,
    selectedBrowsers,
    filteredData,
  );

  features.sort((a, b) => {
    return b.stableStats.last.added - a.stableStats.last.added;
  });

  // Formatter that we will use a couple of times.
  const formatter = new Intl.ListFormat("en", {
    style: "long",
    type: "conjunction",
  });
  const browserList = formatter.format(helper.getBrowserNames(selectedBrowsers));

  const data: WhenRender = {
    bcd,
    features,
    browserList,
    browsers,
    helper,
    featureConfig,
    selectedFeatures,
    selectedBrowsers,
    submitted,
    warnings
  };

  return controllers[responseType](data);
}
