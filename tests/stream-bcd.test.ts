import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  compileWebFeatures,
  type RawWebFeaturesBundle,
} from "../src/data/compiler.ts";
import { streamCompileBcd } from "../src/data/stream-bcd.ts";
import type { CompactFeature, Manifest } from "../src/types.ts";

function createChunkedFileStream(
  filePath: string,
  chunkSize: number,
): ReadableStream<Uint8Array> {
  const bytes = fs.readFileSync(filePath);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(bytes.length, offset + chunkSize);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}

describe("streamCompileBcd parity & edge cases", () => {
  it("matches scripts/build-data.ts output identically even with irregular 137-byte chunks", async () => {
    const bcdPath = path.resolve("node_modules/@mdn/browser-compat-data/data.json");
    const wfPath = path.resolve("node_modules/web-features/data.json");
    const wfPkgPath = path.resolve("node_modules/web-features/package.json");
    const diskManifest = JSON.parse(
      fs.readFileSync(path.resolve("public/data/manifest.json"), "utf8"),
    ) as Manifest;

    const rawWfData = JSON.parse(
      fs.readFileSync(wfPath, "utf8"),
    ) as RawWebFeaturesBundle;
    const wfPkg = JSON.parse(fs.readFileSync(wfPkgPath, "utf8")) as {
      version: string;
    };

    const written = new Map<string, string>();
    const result = await streamCompileBcd({
      openBcdStream: async () => createChunkedFileStream(bcdPath, 137),
      rawWfData,
      webFeaturesVersion: wfPkg.version,
      onShardWrite: async (key, json) => {
        written.set(key, json);
      },
    });

    assert.equal(result.manifest.bcdVersion, diskManifest.bcdVersion);
    assert.equal(
      result.manifest.webFeaturesVersion,
      diskManifest.webFeaturesVersion,
    );
    assert.deepEqual(result.manifest.counts, diskManifest.counts);
    assert.deepEqual(result.manifest.categoryShards, diskManifest.categoryShards);
    assert.equal(result.manifest.webFeatureCount, diskManifest.webFeatureCount);

    // Compare actual shard contents against build-data output
    for (const file of result.manifest.files) {
      if (file === "manifest.json" || file === "precomputed.json") continue;
      const streamedVal = JSON.parse(written.get(`current/${file}`)!) as unknown;
      const diskVal = JSON.parse(
        fs.readFileSync(path.resolve("public/data", file), "utf8"),
      ) as unknown;
      assert.deepEqual(streamedVal, diskVal, `Mismatch in shard ${file}`);
    }

    // Spot check story metrics parity
    const diskPre = JSON.parse(
      fs.readFileSync(path.resolve("public/data/precomputed.json"), "utf8"),
    ) as { stories: Array<{ slug: string; metrics: unknown }> };
    assert.deepEqual(
      result.precomputed.stories.map((s) => ({ slug: s.slug, metrics: s.metrics })),
      diskPre.stories.map((s) => ({ slug: s.slug, metrics: s.metrics })),
    );
  });

  it("handles web-features v3 kind=moved/split and <= approximate Baseline dates", () => {
    const mockBrowsers = {
      chrome: {
        name: "Chrome",
        type: "desktop" as const,
        releases: { "45": { release_date: "2015-09-01", status: "retired" } },
      },
    };
    const wfBundle: RawWebFeaturesBundle = {
      groups: { grid: { name: "Grid" } },
      features: {
        active_feat: {
          kind: "feature",
          name: "Active Feature",
          group: ["grid"],
          spec: ["https://example.com/spec"],
          compat_features: ["css.properties.grid"],
          status: {
            baseline: "high",
            baseline_low_date: "≤2015-07-29",
            baseline_high_date: "≤2018-01-29",
            support: { chrome: "≤45" },
          },
        },
        moved_feat: {
          kind: "moved",
          name: "Moved Feature",
        },
        split_feat: {
          kind: "split",
          name: "Split Feature",
        },
      },
    };

    const { webFeatures, bcdToWf } = compileWebFeatures(wfBundle, mockBrowsers);
    assert.equal(webFeatures.length, 1);
    assert.equal(webFeatures[0].id, "active_feat");
    assert.equal(webFeatures[0].groupName, "Grid");
    assert.equal(webFeatures[0].spec, "https://example.com/spec");
    assert.ok((webFeatures[0].baselineLowDay ?? 0) > 16000);
    assert.equal(webFeatures[0].s.chrome.le, 1);
    assert.ok(bcdToWf.has("css.properties.grid"));
  });

  it("reads snapshots/ manifest and respects alphabetical shard range", async () => {
    const shard0 = JSON.parse(
      fs.readFileSync(path.resolve("public/data/cat-api-0.json"), "utf8"),
    ) as CompactFeature[];
    assert.ok(shard0.length > 0);
    for (let i = 1; i < shard0.length; i++) {
      assert.ok(shard0[i - 1].id <= shard0[i].id);
    }
  });
});
