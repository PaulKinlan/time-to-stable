import { BrowserName } from "https://esm.sh/@mdn/browser-compat-data@latest/types.d.ts";
import { ValidFeatures } from "./types.d.ts";

export function parseSelectedFeatures(request: Request): Set<ValidFeatures> {
  const url = new URL(request.url);
  const features = [...url.searchParams.keys()].filter(key => key.startsWith('feature-')).map(key => <ValidFeatures>key.replace('feature-', ''));
  return new Set<ValidFeatures>(features);
}

export function parseSelectedBrowsers(request: Request): Set<BrowserName> {
  const url = new URL(request.url);
  const browserNames = [...url.searchParams.keys()].filter(key => key.startsWith('browser-')).map(key => <BrowserName>key.replace('browser-', ''));
  return new Set<BrowserName>(browserNames);
}
