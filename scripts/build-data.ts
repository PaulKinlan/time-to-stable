import fs from "node:fs";
import path from "node:path";
import { CATEGORIES } from "../src/analysis/query.ts";
import {
  buildPrecomputedAndManifest,
  compileBrowsersMeta,
  compileWebFeatures,
  extractCompactFeaturesFromNode,
  getOrderedBrowserIds,
  shardCategoryFeatures,
  type RawBcdMeta,
  type RawBrowser,
  type RawWebFeaturesBundle,
} from "../src/data/compiler.ts";
import type { CategoryShardMeta, CategorySlug, CompactFeature } from "../src/types.ts";

function parseOutDirArg(): string {
  const idx = process.argv.indexOf("--out");
  if (idx !== -1 && process.argv[idx + 1]) {
    return path.resolve(process.argv[idx + 1]);
  }
  return path.resolve("public/data");
}

function main() {
  const started = Date.now();
  const outDir = parseOutDirArg();
  fs.mkdirSync(outDir, { recursive: true });
  for (const existing of fs.readdirSync(outDir)) {
    if (existing.startsWith("cat-") && existing.endsWith(".json")) {
      fs.unlinkSync(path.join(outDir, existing));
    }
  }

  const bcdPath = path.resolve("node_modules/@mdn/browser-compat-data/data.json");
  const wfPath = path.resolve("node_modules/web-features/data.json");
  const wfPkgPath = path.resolve("node_modules/web-features/package.json");

  const bcd = JSON.parse(fs.readFileSync(bcdPath, "utf8")) as {
    __meta: RawBcdMeta;
    browsers: Record<string, RawBrowser>;
    [key: string]: unknown;
  };
  const wfData = JSON.parse(
    fs.readFileSync(wfPath, "utf8"),
  ) as RawWebFeaturesBundle;
  const wfPkg = JSON.parse(fs.readFileSync(wfPkgPath, "utf8")) as {
    version: string;
  };

  const rawBrowsers = bcd.browsers;
  const orderedIds = getOrderedBrowserIds(rawBrowsers);
  const browsersMeta = compileBrowsersMeta(rawBrowsers);
  const { webFeatures, bcdToWf } = compileWebFeatures(wfData, rawBrowsers);

  const allBcdFeatures: CompactFeature[] = [];
  const counts = {} as Record<CategorySlug, number>;
  const categoryShards = {} as Record<CategorySlug, CategoryShardMeta[]>;
  const shardFiles: string[] = [];

  for (const cat of CATEGORIES) {
    const catFeatures = bcd[cat]
      ? extractCompactFeaturesFromNode(
          bcd[cat],
          cat,
          cat,
          orderedIds,
          rawBrowsers,
          bcdToWf,
        )
      : [];

    counts[cat] = catFeatures.length;
    const { shardsMeta, shardPayloads } = shardCategoryFeatures(
      cat,
      catFeatures,
    );
    categoryShards[cat] = shardsMeta;
    for (const payload of shardPayloads) {
      fs.writeFileSync(path.join(outDir, payload.file), payload.json);
      shardFiles.push(payload.file);
    }
    allBcdFeatures.push(...catFeatures);
  }

  const { manifest, precomputed, historySeed } = buildPrecomputedAndManifest({
    bcdMeta: bcd.__meta,
    webFeaturesVersion: wfPkg.version,
    browsersMeta,
    allBcdFeatures,
    webFeatures,
    counts,
    categoryShards,
    shardFiles,
  });

  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, "browsers.json"),
    JSON.stringify(browsersMeta),
  );
  fs.writeFileSync(
    path.join(outDir, "web-features.json"),
    JSON.stringify(webFeatures),
  );
  fs.writeFileSync(
    path.join(outDir, "history-seed.json"),
    JSON.stringify(historySeed, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, "precomputed.json"),
    JSON.stringify(precomputed),
  );

  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  let totalBytes = 0;
  console.log(
    `Built BCD v${manifest.bcdVersion} + web-features v${manifest.webFeaturesVersion} into ${outDir} in ${Date.now() - started}ms:`,
  );
  for (const file of files) {
    const size = fs.statSync(path.join(outDir, file)).size;
    totalBytes += size;
    console.log(`  ${file}: ${(size / 1024).toFixed(1)} KB`);
  }
  console.log(`  TOTAL: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
}

main();
