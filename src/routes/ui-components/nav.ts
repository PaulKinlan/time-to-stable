import template from "../../flora.ts";

export default function renderNavigation(
  selectedBrowsers?: Set<string>,
  selectedFeatures?: Set<string>
): ReadableStream<any> {
  console.log(selectedBrowsers);
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

  const withSelection = (path: string) => {
    return selectedBrowsersQuery || selectedFeaturesQuery
      ? template`(<a href="${path}?${[
          selectedBrowsersQuery,
          selectedFeaturesQuery,
        ].join("&")}">with selection</a>)`
      : template``;
  };

  return template`<nav>
  <ol>
      <li><a href="/">Time to Stable</a> ${withSelection("/")}</li>
      <li><a href="/not-stable">Not Yet Stable</a> ${withSelection(
        "/not-stable"
      )}</li>
      <li><a href="/when-stable">Now Stable</a> ${withSelection(
        "/when-stable"
      )}</li>
      <li><a href="/experimental">Experimental APIs</a> ${withSelection(
        "/experimental"
      )}</li>
      <li><a href="/deprecated">Deprecated APIs</a> ${withSelection(
        "/deprecated"
      )}</li>
      <li><a href="/removed">APIs that are no longer on the web</a> ${withSelection(
        "/removed"
      )}</li>
      <li><a href="/all">All APIs (for export)</a> ${withSelection("/all")}</li>
  </ol>
</nav>`;
}
