import type { RawWebFeaturesBundle } from "./compiler.ts";
import { appendHistorySnapshot, getHistorySnapshots } from "./history.ts";
import { DataStore, invalidateDataCache } from "./store.ts";
import { streamCompileBcd } from "./stream-bcd.ts";
import type {
  Env,
  HistorySnapshot,
  Manifest,
  PrecomputedData,
  SyncStatus,
} from "../types.ts";

const NPM_BCD_LATEST = "https://registry.npmjs.org/@mdn/browser-compat-data/latest";
const NPM_WF_LATEST = "https://registry.npmjs.org/web-features/latest";

async function fetchNpmVersion(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "time-to-stable-worker" },
  });
  if (!res.ok) {
    throw new Error(`npm registry fetch failed (${res.status}) for ${url}`);
  }
  const json = (await res.json()) as { version?: string };
  if (!json.version) throw new Error(`Missing version in ${url}`);
  return json.version;
}

async function constantTimeHashEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) {
    diff |= va[i] ^ vb[i];
  }
  return diff === 0;
}

export async function isAuthorizedAdminRequest(
  request: Request,
  env: Env,
): Promise<boolean> {
  if (!env.SYNC_SECRET) return false;
  const auth = request.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return false;
  return constantTimeHashEqual(token, env.SYNC_SECRET);
}

async function fetchFirstOk(
  urls: readonly string[],
  accept = "application/json",
): Promise<{ url: string; response: Response }> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: accept,
          "User-Agent": "time-to-stable-worker",
        },
        redirect: "follow",
      });
      if (res.ok && res.body) {
        return { url, response: res };
      }
      errors.push(`${url} -> ${res.status}`);
      await res.body?.cancel().catch(() => {});
    } catch (err) {
      errors.push(`${url} -> ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`All upstream fetches failed: ${errors.join("; ")}`);
}

async function pullShardsFromSourceUrl(
  env: Env,
  sourceBaseUrl: string,
): Promise<{ manifest: Manifest; syncedFiles: number }> {
  if (!env.DATA_BUCKET) {
    throw new Error("DATA_BUCKET R2 binding is not configured");
  }
  const base = sourceBaseUrl.replace(/\/+$/, "");
  const mRes = await fetch(`${base}/manifest.json`, {
    headers: { "User-Agent": "time-to-stable-worker" },
  });
  if (!mRes.ok) {
    throw new Error(`Failed to fetch manifest from ${base}: ${mRes.status}`);
  }
  const manifest = (await mRes.json()) as Manifest;
  const nonManifest = (manifest.files || []).filter((f) => f !== "manifest.json");

  for (const file of nonManifest) {
    const res = await fetch(`${base}/${file}`, {
      headers: { "User-Agent": "time-to-stable-worker" },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch shard ${file}: ${res.status}`);
    }
    const text = await res.text();
    await env.DATA_BUCKET.put(`current/${file}`, text, {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
  }

  const manifestJson = JSON.stringify(manifest, null, 2);
  await env.DATA_BUCKET.put(
    `snapshots/${manifest.bcdVersion}/manifest.json`,
    manifestJson,
    { httpMetadata: { contentType: "application/json; charset=utf-8" } },
  );
  await env.DATA_BUCKET.put("current/manifest.json", manifestJson, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });

  await recordHistoryFromR2(env, manifest);
  invalidateDataCache();
  return { manifest, syncedFiles: nonManifest.length + 1 };
}

async function selfSyncFromUpstream(
  env: Env,
  bcdVersion: string,
  wfVersion: string,
): Promise<{ manifest: Manifest; shardCount: number }> {
  if (!env.DATA_BUCKET) {
    throw new Error("DATA_BUCKET R2 binding is not configured");
  }

  const wfUrls = [
    `https://unpkg.com/web-features@${wfVersion}/data.json`,
    `https://cdn.jsdelivr.net/npm/web-features@${wfVersion}/data.json`,
    `https://github.com/web-platform-dx/web-features/releases/download/v${wfVersion}/data.json`,
  ];
  const bcdUrls = [
    `https://unpkg.com/@mdn/browser-compat-data@${bcdVersion}/data.json`,
    `https://cdn.jsdelivr.net/npm/@mdn/browser-compat-data@${bcdVersion}/data.json`,
    `https://cdn.jsdelivr.net/npm/@mdn/browser-compat-data@${bcdVersion}/build/data.json`,
    `https://github.com/mdn/browser-compat-data/releases/download/v${bcdVersion}/data.json`,
  ];

  const { response: wfRes } = await fetchFirstOk(wfUrls);
  const rawWfData = (await wfRes.json()) as RawWebFeaturesBundle;
  const existingHistory = await getHistorySnapshots(env);

  let resolvedBcdUrl: string | null = null;
  const openBcdStream = async (): Promise<ReadableStream<Uint8Array>> => {
    if (resolvedBcdUrl) {
      const res = await fetch(resolvedBcdUrl, {
        headers: { Accept: "application/json", "User-Agent": "time-to-stable-worker" },
        redirect: "follow",
      });
      if (res.ok && res.body) return res.body;
    }
    const { url, response } = await fetchFirstOk(bcdUrls);
    resolvedBcdUrl = url;
    return response.body!;
  };

  const bucket = env.DATA_BUCKET;
  const compiled = await streamCompileBcd({
    openBcdStream,
    rawWfData,
    webFeaturesVersion: wfVersion,
    existingHistory,
    onShardWrite: async (r2Key, json) => {
      await bucket.put(r2Key, json, {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
      });
    },
  });

  await appendHistorySnapshot(env, compiled.historySnapshot);
  invalidateDataCache();

  return {
    manifest: compiled.manifest,
    shardCount: compiled.shardCount,
  };
}

async function recordHistoryFromR2(env: Env, manifest: Manifest): Promise<void> {
  if (!env.DATA_BUCKET) return;
  try {
    const preObj = await env.DATA_BUCKET.get("current/precomputed.json");
    if (!preObj) return;
    const pre = (await preObj.json()) as PrecomputedData;
    const core3 = pre.presets["chrome-vs-firefox-vs-safari:bcd"];
    const bcdTotal = Object.values(manifest.counts).reduce((a, b) => a + b, 0);

    const snapshot: HistorySnapshot = {
      date: manifest.bcdTimestamp.slice(0, 10),
      bcdVersion: manifest.bcdVersion,
      webFeaturesVersion: manifest.webFeaturesVersion,
      bcdTotal,
      core3StableBcd: core3?.summary.stableCount ?? 0,
      core3NotStableBcd: core3?.summary.waitingCount ?? 0,
      core3MedianTtaDaysBcd: core3?.summary.distribution.median ?? null,
      webFeaturesTotal: pre.baselineSummary.total,
      baselineHigh: pre.baselineSummary.high,
      baselineLow: pre.baselineSummary.low,
      baselineLimited: pre.baselineSummary.limited,
    };
    await appendHistorySnapshot(env, snapshot);
  } catch {
    // non-fatal
  }
}

export async function runScheduledCheck(
  env: Env,
  opts: { force?: boolean } = {},
): Promise<SyncStatus> {
  const store = new DataStore(env);
  const manifest = await store.getManifest();
  const checkedAt = new Date().toISOString();

  let currentBcdVersion = manifest.bcdVersion;
  let currentWebFeaturesVersion = manifest.webFeaturesVersion;
  let latestBcdVersion = manifest.bcdVersion;
  let latestWebFeaturesVersion = manifest.webFeaturesVersion;
  let actionTriggered: string | undefined;
  let lastUpdatedAt: string | undefined;
  let updateAvailable = false;

  try {
    const [bcdLatest, wfLatest] = await Promise.all([
      fetchNpmVersion(NPM_BCD_LATEST),
      fetchNpmVersion(NPM_WF_LATEST),
    ]);
    latestBcdVersion = bcdLatest;
    latestWebFeaturesVersion = wfLatest;

    const needsUpdate =
      opts.force === true ||
      bcdLatest !== manifest.bcdVersion ||
      wfLatest !== manifest.webFeaturesVersion;

    updateAvailable = needsUpdate;

    if (needsUpdate) {
      if (env.DATA_BUCKET && env.DATA_SOURCE_URL) {
        const result = await pullShardsFromSourceUrl(env, env.DATA_SOURCE_URL);
        currentBcdVersion = result.manifest.bcdVersion;
        currentWebFeaturesVersion = result.manifest.webFeaturesVersion;
        updateAvailable = false;
        lastUpdatedAt = new Date().toISOString();
        actionTriggered = `synced-${result.syncedFiles}-shards-from-source`;
      } else if (env.DATA_BUCKET) {
        const result = await selfSyncFromUpstream(env, bcdLatest, wfLatest);
        currentBcdVersion = result.manifest.bcdVersion;
        currentWebFeaturesVersion = result.manifest.webFeaturesVersion;
        updateAvailable = false;
        lastUpdatedAt = new Date().toISOString();
        actionTriggered = `self-synced-${result.shardCount}-shards-on-cloudflare`;
      } else {
        actionTriggered = "update-detected-no-r2-bucket";
      }
    } else {
      actionTriggered = "up-to-date";
    }

    const status: SyncStatus = {
      checkedAt,
      currentBcdVersion,
      currentWebFeaturesVersion,
      latestBcdVersion,
      latestWebFeaturesVersion,
      updateAvailable,
      ...(lastUpdatedAt ? { lastUpdatedAt } : {}),
      ...(actionTriggered ? { actionTriggered } : {}),
    };

    if (env.DATA_BUCKET) {
      await env.DATA_BUCKET.put(
        "sync-status.json",
        JSON.stringify(status, null, 2),
        { httpMetadata: { contentType: "application/json; charset=utf-8" } },
      );
    }

    return status;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const status: SyncStatus = {
      checkedAt,
      currentBcdVersion,
      currentWebFeaturesVersion,
      latestBcdVersion,
      latestWebFeaturesVersion,
      updateAvailable,
      error,
    };
    if (env.DATA_BUCKET) {
      await env.DATA_BUCKET.put(
        "sync-status.json",
        JSON.stringify(status, null, 2),
        { httpMetadata: { contentType: "application/json; charset=utf-8" } },
      ).catch(() => {});
    }
    return status;
  }
}

const ADMIN_JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export async function handleAdminSync(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!(await isAuthorizedAdminRequest(request, env))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: ADMIN_JSON_HEADERS,
    });
  }
  if (!env.DATA_BUCKET) {
    return new Response(
      JSON.stringify({ error: "DATA_BUCKET binding is not configured" }),
      { status: 500, headers: ADMIN_JSON_HEADERS },
    );
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const key = url.searchParams.get("key");

  if (action === "commit") {
    const manifest = (await request.json()) as Manifest;
    const manifestJson = JSON.stringify(manifest, null, 2);
    await env.DATA_BUCKET.put(
      `snapshots/${manifest.bcdVersion}/manifest.json`,
      manifestJson,
      { httpMetadata: { contentType: "application/json; charset=utf-8" } },
    );
    await env.DATA_BUCKET.put("current/manifest.json", manifestJson, {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
    await recordHistoryFromR2(env, manifest);
    invalidateDataCache();

    return new Response(
      JSON.stringify({
        ok: true,
        committed: manifest.bcdVersion,
        webFeaturesVersion: manifest.webFeaturesVersion,
      }),
      { status: 200, headers: ADMIN_JSON_HEADERS },
    );
  }

  if (!key || !/^[a-z0-9._-]+\.json$/i.test(key)) {
    return new Response(
      JSON.stringify({ error: "Invalid or missing shard key parameter" }),
      { status: 400, headers: ADMIN_JSON_HEADERS },
    );
  }

  const body = await request.text();
  await env.DATA_BUCKET.put(`current/${key}`, body, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
  });

  return new Response(
    JSON.stringify({ ok: true, key: `current/${key}`, bytes: body.length }),
    { status: 200, headers: ADMIN_JSON_HEADERS },
  );
}

export async function handleAdminCheck(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!(await isAuthorizedAdminRequest(request, env))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: ADMIN_JSON_HEADERS,
    });
  }
  const status = await runScheduledCheck(env);
  return new Response(JSON.stringify(status, null, 2), {
    status: status.error ? 500 : 200,
    headers: ADMIN_JSON_HEADERS,
  });
}

export async function handleAdminRefresh(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!(await isAuthorizedAdminRequest(request, env))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: ADMIN_JSON_HEADERS,
    });
  }
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
  const status = await runScheduledCheck(env, { force });
  return new Response(JSON.stringify(status, null, 2), {
    status: status.error ? 500 : 200,
    headers: ADMIN_JSON_HEADERS,
  });
}
