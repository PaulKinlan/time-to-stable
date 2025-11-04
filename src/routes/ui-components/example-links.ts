import template from "../../flora.ts";
import { BrowserName, ValidFeatures } from "../../types.d.ts";

const BROWSERS: BrowserName[] = [
  "chrome",
  "chrome_android",
  "safari",
  "safari_ios",
  "firefox",
  "edge"
];

const BROWSER_NAMES: Record<string, string> = {
  "chrome": "Chrome",
  "chrome_android": "Chrome on Android",
  "safari": "Safari",
  "safari_ios": "Safari on iOS",
  "firefox": "Firefox",
  "edge": "Edge"
};

const FEATURES: ValidFeatures[] = ["api", "html", "css", "javascript"];

const FEATURE_NAMES: Record<ValidFeatures, string> = {
  "api": "DOM API",
  "html": "HTML",
  "css": "CSS",
  "javascript": "JS",
  "http": "HTTP",
  "webassembly": "WebAssembly"
};

function getRandomItems<T>(array: T[], count: number): T[] {
  const shuffled = [...array].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function generateExampleLink(path: string): { url: string; text: string } {
  const selectedBrowsers = getRandomItems(BROWSERS, 2);
  const selectedFeatures = getRandomItems(FEATURES, 2);
  
  const browserParams = selectedBrowsers.map(b => `browser-${b}=on`).join("&");
  const featureParams = selectedFeatures.map(f => `feature-${f}=on`).join("&");
  
  const url = `${path}?${browserParams}&${featureParams}`;
  
  const browserText = selectedBrowsers.map(b => BROWSER_NAMES[b]).join(" vs ");
  const featureText = selectedFeatures.map(f => FEATURE_NAMES[f]).join(" and ");
  
  const text = `Compare ${browserText} for ${featureText}`;
  
  return { url, text };
}

export default function renderExampleLinks(path: string, count: number = 3): ReadableStream<any> {
  const examples = Array.from({ length: count }, () => generateExampleLink(path));
  
  return template`<details>
  <summary>Example Comparisons</summary>
  <ul>
    ${examples.map(({ url, text }) => template`<li><a href="${url}">${text}</a></li>`)}
  </ul>
</details>`;
}
