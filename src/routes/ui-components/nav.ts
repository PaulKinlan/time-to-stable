import template from "../../flora.ts";

export default function renderNavigation(
  selectedBrowsers?: Set<string>,
  selectedFeatures?: Set<string>
): ReadableStream<any> {
  const selectedBrowsersArray = Array.from(selectedBrowsers || []);
  const selectedFeaturesArray = Array.from(selectedFeatures || []);

  // Generate the query string from selectedBrowsers
  const selectedBrowsersQuery = selectedBrowsersArray
    .map((browser) => `browser-${browser}=on`)
    .join("&");
  // Generate the query string from selectedFeatures
  const selectedFeaturesQuery = selectedFeaturesArray
    .map((feature) => `feature-${feature}=on`)
    .join("&");

  return template`<nav>
  <ol>
      <li><a href="/">Time to Stable</a> (<a href="/?${selectedBrowsersQuery}&${selectedBrowsersQuery}">with selection</a>)</li>
      <li><a href="/not-stable">Not Yet Stable</a></li>
      <li><a href="/when-stable">Now Stable</a></li>
      <li><a href="/experimental">Experimental APIs</a></li>
      <li><a href="/deprecated">Deprecated APIs</a></li>
      <li><a href="/removed">APIs that are no longer on the web</a></li>
      <li><a href="/all">All APIs (for export)</a></li>
  </ol>
</nav>`;
}
