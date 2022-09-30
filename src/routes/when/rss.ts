import template from "../../flora.ts";
import { WhenRender } from "../types.d.ts";
import renderBrowsers from "../ui-components/browsers.ts";
import renderFeatures from "../ui-components/features.ts";
import renderWarnings from "../ui-components/warnings.ts";

export default function render({ bcd, stableFeatures, browsers, browserList, selectedBrowsers, selectedFeatures, helper, featureConfig, warnings }: WhenRender): Response {
  let currentMonth = "";

  const { __meta } = bcd

  return new Response(template`
  <?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
  <title>Now Stable ${(browserList != "") ? `across ${browserList}` : ""
    }</title>
  <link>https://www.w3schools.com</link>
  <description>Free web building tutorials</description>
  <item>
    <title>RSS Tutorial</title>
    <link>https://www.w3schools.com/xml/xml_rss.asp</link>
    <description>New RSS tutorial on W3Schools</description>
  </item>
  <item>
    <title>XML Tutorial</title>
    <link>https://www.w3schools.com/xml</link>
    <description>New XML tutorial on W3Schools</description>
  </item>
</channel>

</rss>
  <html>

  <head>
	<title>Now Stable ${(browserList != "") ? `across ${browserList}` : ""
    }</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/water.css">
	<meta name="author" content="Paul Kinlan">
  <meta name="description" content="A list of features that are considered stable for ${browserList}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <meta charset="UTF-8">
	<link rel="author" href="https://paul.kinlan.me/">
  <link rel="shortcut icon" href="/images/favicon.png">
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
      <h1>Now Stable</h1>
    </header>
    <nav>
      <ol>
          <li><a href="/">Time to Stable</a></li>
          <li><a href="/when-stable">Now Stable</a></li>
      </ol>
    </nav>
    <p>"New on the Web": For a given set of browsers, what APIs became stable and when, ordered reverse chronologically.</p>
    <p>It's a great source of information for posts like <a href="https://web.dev/tags/new-to-the-web/">this</a></p>
    <form method=GET action="/when-stable">
      ${renderWarnings(warnings)}
      ${renderBrowsers(browsers, selectedBrowsers)}
      ${renderFeatures(featureConfig, selectedFeatures)}
      <input type=reset>
      <input type=submit>
    </form>

    <h2>Stable APIs</h2>
    <p>Below is a list of features that are in ${browserList}, ordered reverse chronologically by when they became stable (i.e, available in the last browser).</p>
    
   ${(warnings.length == 0)
      ? stableFeatures.map((feature) => {
        let response;
        let heading;
        const date = feature.lastDate.getFullYear() + "/" +
          (feature.lastDate.getUTCMonth() + 1);
        if (currentMonth != date) {
          heading = template`
          ${(date == "") ? "" : "</tbody></table>"}
          <h4>${date}</h4>
          <table>
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
        <td><a href="${feature.mdn_url}">${feature.api}</a> ${("spec_url" in feature)
            ? template`<a href="${feature.spec_url}" title="${feature.api} specification">📋</a>`
            : template``
          }</td><td>${helper.getBrowserName(feature.firstBrowser)
          }</td><td>${feature.firstDate.toLocaleDateString()}</td>
        <td>${helper.getBrowserName(feature.lastBrowser)
          }</td><td>${feature.lastDate.toLocaleDateString()}</td><td>${feature.ageInDays}</td></tr>`;

        currentMonth = date;

        return response;
      })
      : ""
    } 
   </tbody>
  </table>
     
    <footer><p>Created by <a href="https://paul.kinlan.me">Paul Kinlan</a>. Using <a href="https://github.com/mdn/browser-compat-data">BCD</a> version: ${__meta.version}, updated on ${__meta.timestamp}</p></footer>
	</body>
  </html>`, {
    status: 200,
    headers: { "content-type": "application/xml" }
  });
};