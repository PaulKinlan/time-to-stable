import { BrowserName, Browsers, CompatData } from "https://esm.sh/@mdn/browser-compat-data@latest/types.d.ts";
import { getStableFeatures } from "../bcd.ts";
import BrowsersHelper from "../browser.ts";
import template from "../flora.ts";
import { parseSelectedBrowsers, parseSelectedFeatures } from "./request-utils.ts";
import { FeatureConfig, ValidFeatures } from "./types.d.ts";
import { renderBrowsers } from "./ui-components/browsers.ts";
import { renderFeatures } from "./ui-components/features.ts";

const generateFirstInLastInCrossTab = (stableFeatures) => {

  const output = {};

  for (const feature of stableFeatures) {
    if (feature.firstBrowser in output == false) {
      output[feature.firstBrowser] = {};
    }

    if (feature.lastBrowser in output[feature.firstBrowser] == false) {
      output[feature.firstBrowser][feature.lastBrowser] = 0;
    }

    output[feature.firstBrowser][feature.lastBrowser]++;
  }
  return output;
};

const renderWarnings = (warnings: Array<string>): ReadableStream<any> => {
  return template`<span class="warning"><ul>${warnings.map(warning => template`<li>${warning}</li>`)}</ul></span>`;
};

function renderResults(bcd: CompatData, browsers: Browsers, helper: BrowsersHelper, browserList, selectedBrowsers: Set<BrowserName>, selectedFeatures: Set<ValidFeatures>, featureConfig: FeatureConfig): ReadableStream<any> {

  let currentCategory = "";

  // only show the features selected.
  const filteredData = Object.fromEntries(Object.entries(bcd).filter(([key]) => selectedFeatures.has(key)));

  const stableFeatures = getStableFeatures(browsers, selectedBrowsers, filteredData);

  const tablulateSummary = generateFirstInLastInCrossTab(stableFeatures);

  const output = template`<h2>Stable APIs</h2>
  <p>Below is a list of features that are in ${browserList}</p>
  <h3>Summary</h3>
  
  <table class=tabular>
    <caption>A count of the number of APIs that landed in A first and B last.</caption>
    <thead>
      <tr>
        <th></th>
        ${[...selectedBrowsers].map(key => template`<th>Last in ${helper.getBrowserName(key)}</th>`)} 
      </tr>
    </thead>
    <tbody>
      ${[...selectedBrowsers].map((firstInKey) => template`<tr>
        <th scope="row">First in ${helper.getBrowserName(firstInKey)}</th>
        ${[...selectedBrowsers].map((lastInKey) => template`<td>${tablulateSummary[firstInKey][lastInKey]}</td>`)}
        </tr>`)} 
    </tbody>
  </table>

  <h3>Raw Data</h3>
  Quick Links: <ul>${[...selectedFeatures].map(selectedFeature => template`<li><a href="#${selectedFeature}-table">${featureConfig[selectedFeature].name}</a></li>`)}</ul>
  ${stableFeatures.map(feature => {
    let response;
    let heading;
    if (currentCategory != feature.category) {
      heading = template`
        ${(currentCategory == "") ? "" : "</tbody></table>"}
        <h4>${featureConfig[feature.category].name} Data</h4>
        <table id="${feature.category}-table">
        <thead>
          <tr>
            <th>API</th>
            <th>First Browser</th>
            <th>Date</th>
            <th>Last Browser</th>
            <th>Date</th>
            <th>Days</th>
          </tr>
        </thead>
        <tbody>`;
    }

    response = template`${(heading != undefined) ? heading : ""}<tr>
    <td><a href="${feature.mdn_url}">${feature.api}</a> ${("spec_url" in feature) ? template`<a href="${feature.spec_url}" title="${feature.api} specification">📋</a>` : template``}</td><td>${helper.getBrowserName(feature.firstBrowser)}</td><td>${feature.firstDate.toLocaleDateString()}</td>
    <td>${helper.getBrowserName(feature.lastBrowser)}</td><td>${feature.lastDate.toLocaleDateString()}</td><td>${feature.ageInDays}</td></tr>`;

    currentCategory = feature.category;

    return response;
  }
  )}
 </tbody>
</table>`;

  return output;
}


export default function render(request: Request, bcd: CompatData): Response {

  const url = new URL(request.url);
  const { __meta, browsers } = bcd;
  const featureConfig: FeatureConfig = { 'api': { name: "DOM API" }, 'css': { name: "CSS" }, 'html': { name: "HTML" }, 'javascript': { name: "JavaScript" } };

  const warnings = new Array<string>();
  const helper = new BrowsersHelper(browsers);

  const selectedBrowsers = parseSelectedBrowsers(request);
  const selectedFeatures = parseSelectedFeatures(request);

  const submitted = url.href.indexOf("?") > -1; // Likely submitted from form with nothing selected.

  if (selectedBrowsers.size < 2 && submitted) {
    warnings.push("Choose at least two browsers to compare");
  }

  if (selectedFeatures.size < 1 && submitted) {
    warnings.push("Choose at least one feature to show");
  }

  // Formatter that we will use a couple of times.
  const formatter = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });
  const browserList = formatter.format(helper.getBrowserNames(selectedBrowsers));

  return template`<html>

  <head>
	<title>Time to Stable ${(browserList != "") ? `across ${browserList}` : ""}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/water.css">
	<meta name="author" content="Paul Kinlan">
  <meta charset="UTF-8">
  <meta name="description" content="A list of features that are considered stable for ${browserList} and when the landed in the first browser and the last">
	<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <link rel="shortcut icon" href="/images/favicon.png">
	<link rel="author" href="https://paul.kinlan.me/">
  <style>

  table {
    table-layout:fixed;
    width: 100%;
  }

  form span.warning {
    color: red;
  }

  </style>
  </head>
  <body>
    <header>
      <h1>Time to Stable</h1>
    </header>
    <nav>
      <ol>
          <li><a href="/">Time to Stable</a></li>
          <li><a href="/when-stable">Now Stable</a></li>
      </ol>
    </nav>
    <p>For a given set of browsers, what APIs are in all of them and how long did it take for the API to land in the first browser to the last.</p>
    <form method=GET action="/" >
      ${renderWarnings(warnings)}
      ${renderBrowsers(browsers, selectedBrowsers)}
      ${renderFeatures(featureConfig, selectedFeatures)}
      <input type=reset>
      <input type=submit>
    </form>

    ${(submitted && warnings.length == 0) ? renderResults(bcd, browsers, helper, browserList, selectedBrowsers, selectedFeatures, featureConfig) : ``}
     
    <footer><p>Created by <a href="https://paul.kinlan.me">Paul Kinlan</a>. Using <a href="https://github.com/mdn/browser-compat-data">BCD</a> version: ${__meta.version}, updated on ${__meta.timestamp}</p></footer>
    </body>
  </html>`
    .then(data => new Response(data, { status: 200, headers: { 'content-type': 'text/html' } }));
}