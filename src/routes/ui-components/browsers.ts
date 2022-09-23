import { BrowserName, Browsers } from "https://esm.sh/@mdn/browser-compat-data@latest/types.d.ts";
import template from "../../flora.ts";

export function renderBrowsers(browsers: Browsers, selectedBrowsers: Set<BrowserName>): ReadableStream<any> {
  return template`<fieldset>
  <legend>Browsers</legend>${Object.entries(browsers).map(([browser, details]) => template`<input type=checkbox name="browser-${browser}" id="browser-${browser}" ${selectedBrowsers.has(<BrowserName>browser) ? template`checked=checked` : template``}>
  <label for="browser-${browser}">${details.name}</label>`)}</fieldset>`;
}
