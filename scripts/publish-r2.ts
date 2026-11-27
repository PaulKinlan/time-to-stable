import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Manifest } from "../src/types.ts";

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return undefined;
}

async function uploadViaAdminApi(
  dataDir: string,
  manifest: Manifest,
  syncUrl: string,
  syncSecret: string,
): Promise<void> {
  const endpoint = syncUrl.replace(/\/+$/, "");
  const nonManifest = manifest.files.filter((f) => f !== "manifest.json");

  for (const file of nonManifest) {
    const body = fs.readFileSync(path.join(dataDir, file), "utf8");
    const res = await fetch(`${endpoint}?key=${encodeURIComponent(file)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${syncSecret}`,
        "Content-Type": "application/json",
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`Upload failed for ${file}: ${res.status} ${await res.text()}`);
    }
    console.log(`Uploaded ${file} via admin API`);
  }

  // Commit manifest last so current/ switches atomically + updates history.json
  const manifestBody = fs.readFileSync(path.join(dataDir, "manifest.json"), "utf8");
  const commitRes = await fetch(`${endpoint}?action=commit`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${syncSecret}`,
      "Content-Type": "application/json",
    },
    body: manifestBody,
  });
  if (!commitRes.ok) {
    throw new Error(
      `Manifest commit failed: ${commitRes.status} ${await commitRes.text()}`,
    );
  }
  console.log("Committed manifest.json and history snapshot:", await commitRes.text());
}

function uploadViaWrangler(
  dataDir: string,
  manifest: Manifest,
  bucket: string,
): void {
  const nonManifest = manifest.files.filter((f) => f !== "manifest.json");
  const putObject = (key: string, filePath: string) => {
    execFileSync(
      "npx",
      [
        "wrangler",
        "r2",
        "object",
        "put",
        `${bucket}/${key}`,
        "--file",
        filePath,
        "--content-type",
        "application/json; charset=utf-8",
        "--remote",
      ],
      { stdio: "inherit" },
    );
  };

  for (const file of nonManifest) {
    putObject(`current/${file}`, path.join(dataDir, file));
  }

  // Write immutable snapshot manifest & current manifest last
  const manifestPath = path.join(dataDir, "manifest.json");
  putObject(`snapshots/${manifest.bcdVersion}/manifest.json`, manifestPath);
  putObject("current/manifest.json", manifestPath);
  console.log(`Published ${manifest.files.length} shards to R2 bucket ${bucket}`);
}

async function main() {
  const dataDir = path.resolve(getArg("--dir") ?? "public/data");
  const bucket = getArg("--bucket") ?? process.env.R2_BUCKET ?? "time-to-stable-data";
  const syncUrl = getArg("--sync-url") ?? process.env.SYNC_URL;
  const syncSecret = getArg("--sync-secret") ?? process.env.SYNC_SECRET;

  const manifestPath = path.join(dataDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing ${manifestPath}. Run npm run build:data first.`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;

  if (syncUrl && syncSecret) {
    await uploadViaAdminApi(dataDir, manifest, syncUrl, syncSecret);
  } else {
    uploadViaWrangler(dataDir, manifest, bucket);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
