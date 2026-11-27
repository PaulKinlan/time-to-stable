import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { invalidateDataCache } from "../src/data/store.ts";
import worker from "../src/worker.ts";
import type { Env } from "../src/types.ts";

function createMockR2(): R2Bucket & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      const val = store.get(key);
      if (val === undefined) return null;
      return {
        key,
        async json() {
          return JSON.parse(val);
        },
        async text() {
          return val;
        },
      } as unknown as R2ObjectBody;
    },
    async put(key: string, value: unknown) {
      let str = "";
      if (typeof value === "string") {
        str = value;
      } else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        str = new TextDecoder().decode(value as ArrayBuffer);
      } else {
        str = await new Response(value as BodyInit).text();
      }
      store.set(key, str);
      return { key } as unknown as R2Object;
    },
  } as unknown as R2Bucket & { store: Map<string, string> };
}

function createMockAssets(): Fetcher {
  const publicDir = path.resolve("public");
  return {
    async fetch(input: RequestInfo | URL) {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      const rel = url.pathname.replace(/^\/+/, "");
      const target = path.resolve(publicDir, rel);
      if (!target.startsWith(publicDir) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        return new Response("Not found", { status: 404 });
      }
      const data = fs.readFileSync(target);
      const ext = path.extname(target);
      const ct =
        ext === ".json"
          ? "application/json; charset=utf-8"
          : ext === ".css"
          ? "text/css; charset=utf-8"
          : ext === ".js"
          ? "application/javascript; charset=utf-8"
          : ext === ".png"
          ? "image/png"
          : "text/html; charset=utf-8";
      return new Response(data, { status: 200, headers: { "content-type": ct } });
    },
  } as unknown as Fetcher;
}

function createTestEnv(overrides: Partial<Env> = {}): {
  env: Env;
  r2: ReturnType<typeof createMockR2>;
  waitPromises: Promise<unknown>[];
  ctx: ExecutionContext;
} {
  const r2 = createMockR2();
  const waitPromises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) {
      waitPromises.push(p);
    },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  const env: Env = {
    ASSETS: createMockAssets(),
    DATA_BUCKET: r2,
    CANONICAL_HOST: "time-to-stable.example.workers.dev",
    REDIRECT_HOSTS: "time-to-stable.deno.dev,time-to-stable.paulkinlan-ea.deno.net",
    SYNC_SECRET: "test-secret-token",
    ...overrides,
  };
  return { env, r2, waitPromises, ctx };
}

describe("Cloudflare Worker integration", () => {
  it("redirects legacy hosts with 301 preserving path and query", async () => {
    const { env, ctx } = createTestEnv();
    const res = await worker.fetch(
      new Request("https://time-to-stable.deno.dev/not-stable?browser-chrome=on&browser-safari=on"),
      env,
      ctx,
    );
    assert.equal(res.status, 301);
    assert.equal(
      res.headers.get("location"),
      "https://time-to-stable.example.workers.dev/not-stable?browser-chrome=on&browser-safari=on",
    );
  });

  it("serves /, Markdown negotiation, ETag 304, and clean /compare/* routes", async () => {
    invalidateDataCache();
    const { env, ctx } = createTestEnv();

    const homeRes = await worker.fetch(new Request("https://time-to-stable.example.workers.dev/"), env, ctx);
    assert.equal(homeRes.status, 200);
    assert.ok(homeRes.headers.get("content-type")?.includes("text/html"));
    assert.ok(homeRes.headers.get("server-timing")?.includes("store;dur="));
    assert.ok(homeRes.headers.get("link")?.includes("/llms.txt"));
    const etag = homeRes.headers.get("etag");
    assert.ok(etag);
    const homeHtml = await homeRes.text();
    assert.ok(homeHtml.includes("Time to Stable across Chrome, Firefox, and Safari"));
    assert.ok(homeHtml.includes('<link rel="canonical"'));
    assert.ok(homeHtml.includes("application/ld+json"));

    const notModRes = await worker.fetch(
      new Request("https://time-to-stable.example.workers.dev/", {
        headers: { "if-none-match": etag! },
      }),
      env,
      ctx,
    );
    assert.equal(notModRes.status, 304);

    const mdRes = await worker.fetch(
      new Request("https://time-to-stable.example.workers.dev/", {
        headers: { accept: "text/markdown" },
      }),
      env,
      ctx,
    );
    assert.equal(mdRes.status, 200);
    assert.ok(mdRes.headers.get("content-type")?.includes("text/markdown"));
    const mdText = await mdRes.text();
    assert.ok(mdText.includes("# Time to Stable across Chrome, Firefox, and Safari"));

    const compareRes = await worker.fetch(
      new Request("https://time-to-stable.example.workers.dev/compare/chrome-vs-safari/css"),
      env,
      ctx,
    );
    assert.equal(compareRes.status, 200);
    const compareHtml = await compareRes.text();
    assert.ok(compareHtml.includes("Chrome and Safari"));
  });

  it("serves /stories, /baseline, /feature/:id, lifecycle pages, and exports", async () => {
    invalidateDataCache();
    const { env, ctx } = createTestEnv();

    const storiesRes = await worker.fetch(
      new Request("https://time-to-stable.example.workers.dev/stories/is-the-web-getting-faster"),
      env,
      ctx,
    );
    assert.equal(storiesRes.status, 200);
    assert.ok((await storiesRes.text()).includes("Kaplan–Meier"));

    const featureWfRes = await worker.fetch(
      new Request("https://time-to-stable.example.workers.dev/feature/subgrid"),
      env,
      ctx,
    );
    assert.equal(featureWfRes.status, 200);
    assert.ok((await featureWfRes.text()).includes("Subgrid"));

    const featureBcdRes = await worker.fetch(
      new Request("https://time-to-stable.example.workers.dev/feature/css.properties.grid-template-columns.subgrid?type=json"),
      env,
      ctx,
    );
    assert.equal(featureBcdRes.status, 200);
    const bcdJson = (await featureBcdRes.json()) as { kind: string; bcdFeature: { id: string } };
    assert.equal(bcdJson.kind, "bcd");
    assert.equal(bcdJson.bcdFeature.id, "css.properties.grid-template-columns.subgrid");

    const rssRes = await worker.fetch(
      new Request("https://time-to-stable.example.workers.dev/when-stable?browser-chrome=on&browser-firefox=on&feature-css=on&type=rss"),
      env,
      ctx,
    );
    assert.equal(rssRes.status, 200);
    assert.ok(rssRes.headers.get("content-type")?.includes("application/rss+xml"));
    assert.ok((await rssRes.text()).includes("<rss version=\"2.0\""));

    const baselineRes = await worker.fetch(
      new Request("https://time-to-stable.example.workers.dev/baseline"),
      env,
      ctx,
    );
    assert.equal(baselineRes.status, 200);
    assert.ok((await baselineRes.text()).includes("WebDX Baseline Explorer"));

    for (const pathItem of ["/not-stable", "/experimental", "/deprecated", "/removed", "/all"]) {
      const r = await worker.fetch(
        new Request(`https://time-to-stable.example.workers.dev${pathItem}?browser-chrome=on&browser-firefox=on&feature-css=on`),
        env,
        ctx,
      );
      assert.equal(r.status, 200, `Failed ${pathItem}`);
    }

    const badExport = await worker.fetch(
      new Request("https://time-to-stable.example.workers.dev/?browser-chrome=on&type=json"),
      env,
      ctx,
    );
    assert.equal(badExport.status, 400);
  });

  it("serves agent endpoints, SEO files, JSON APIs, and static assets", async () => {
    invalidateDataCache();
    const { env, ctx } = createTestEnv();

    for (const p of [
      "/llms.txt",
      "/llms-full.txt",
      "/openapi.json",
      "/robots.txt",
      "/sitemap.xml",
      "/sitemaps/core.xml",
      "/sitemaps/features.xml",
      "/api/meta",
      "/api/compare?browsers=chrome,safari&categories=css",
      "/api/features?browsers=chrome,safari&categories=css&q=subgrid",
      "/api/stories",
      "/styles/app.css",
      "/scripts/app.js",
      "/google1bf7ef037ae116eb.html",
    ]) {
      const res = await worker.fetch(
        new Request(`https://time-to-stable.example.workers.dev${p}`),
        env,
        ctx,
      );
      assert.equal(res.status, 200, `Expected 200 for ${p}, got ${res.status}`);
    }

    const notFound = await worker.fetch(
      new Request("https://time-to-stable.example.workers.dev/definitely-does-not-exist"),
      env,
      ctx,
    );
    assert.equal(notFound.status, 404);
  });

  it("enforces auth on /api/admin/sync and runs scheduled npm checks into R2", async () => {
    invalidateDataCache();
    const { env, r2, waitPromises, ctx } = createTestEnv();

    const unauth = await worker.fetch(
      new Request("https://time-to-stable.example.workers.dev/api/admin/sync?key=test.json", {
        method: "POST",
        body: "{}",
      }),
      env,
      ctx,
    );
    assert.equal(unauth.status, 401);

    const authPut = await worker.fetch(
      new Request("https://time-to-stable.example.workers.dev/api/admin/sync?key=test.json", {
        method: "POST",
        headers: { authorization: "Bearer test-secret-token" },
        body: '{"ok":true}',
      }),
      env,
      ctx,
    );
    assert.equal(authPut.status, 200);
    assert.equal(r2.store.get("current/test.json"), '{"ok":true}');

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u === "https://registry.npmjs.org/@mdn/browser-compat-data/latest") {
        return new Response(JSON.stringify({ version: "99.0.0" }), { status: 200 });
      }
      if (u === "https://registry.npmjs.org/web-features/latest") {
        return new Response(JSON.stringify({ version: "99.0.0" }), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    try {
      await worker.scheduled({} as ScheduledController, env, ctx);
      await Promise.all(waitPromises);
      const syncRaw = r2.store.get("sync-status.json");
      assert.ok(syncRaw, "sync-status.json was not written by scheduled()");
      const syncJson = JSON.parse(syncRaw!) as { updateAvailable: boolean; latestBcdVersion: string; error?: string };
      assert.equal(syncJson.updateAvailable, true);
      assert.equal(syncJson.latestBcdVersion, "99.0.0");
      assert.ok(syncJson.error?.includes("All upstream fetches failed"));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("enforces auth on /api/admin/refresh and self-syncs BCD + web-features into R2", async () => {
    invalidateDataCache();
    const { env, r2, ctx } = createTestEnv();

    const unauth = await worker.fetch(
      new Request("https://time-to-stable.example.workers.dev/api/admin/refresh", {
        method: "POST",
      }),
      env,
      ctx,
    );
    assert.equal(unauth.status, 401);

    const mockBcd = JSON.stringify({
      __meta: { version: "99.1.0", timestamp: "2026-11-28T00:00:00Z" },
      api: {
        TestApi: {
          __compat: {
            status: { standard_track: true, experimental: false, deprecated: false },
            support: {
              chrome: { version_added: "100" },
              firefox: { version_added: "100" },
              safari: { version_added: "16" },
            },
          },
        },
      },
      browsers: {
        chrome: { name: "Chrome", type: "desktop", releases: { "100": { release_date: "2022-03-29", status: "retired" } } },
        firefox: { name: "Firefox", type: "desktop", releases: { "100": { release_date: "2022-05-03", status: "retired" } } },
        safari: { name: "Safari", type: "desktop", releases: { "16": { release_date: "2022-09-12", status: "retired" } } },
      },
      css: {},
      html: {},
      http: {},
      javascript: {},
      webassembly: {},
    });

    const mockWf = JSON.stringify({
      groups: { dom: { name: "DOM" } },
      features: {
        "test-api": {
          kind: "feature",
          name: "Test API",
          group: ["dom"],
          compat_features: ["api.TestApi"],
          status: {
            baseline: "high",
            baseline_low_date: "2022-09-12",
            support: { chrome: "100", firefox: "100", safari: "16" },
          },
        },
      },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u === "https://registry.npmjs.org/@mdn/browser-compat-data/latest") {
        return new Response(JSON.stringify({ version: "99.1.0" }), { status: 200 });
      }
      if (u === "https://registry.npmjs.org/web-features/latest") {
        return new Response(JSON.stringify({ version: "9.1.0" }), { status: 200 });
      }
      if (u.includes("@mdn/browser-compat-data@99.1.0/data.json")) {
        return new Response(mockBcd, { status: 200 });
      }
      if (u.includes("web-features@9.1.0/data.json")) {
        return new Response(mockWf, { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    try {
      const res = await worker.fetch(
        new Request("https://time-to-stable.example.workers.dev/api/admin/refresh", {
          method: "POST",
          headers: { authorization: "Bearer test-secret-token" },
        }),
        env,
        ctx,
      );
      assert.equal(res.status, 200);
      const status = (await res.json()) as {
        currentBcdVersion: string;
        currentWebFeaturesVersion: string;
        updateAvailable: boolean;
        actionTriggered: string;
      };
      assert.equal(status.currentBcdVersion, "99.1.0");
      assert.equal(status.currentWebFeaturesVersion, "9.1.0");
      assert.equal(status.updateAvailable, false);
      assert.ok(status.actionTriggered.includes("self-synced-"));

      assert.ok(r2.store.has("current/manifest.json"));
      assert.ok(r2.store.has("snapshots/99.1.0/manifest.json"));
      assert.ok(r2.store.has("history.json"));

      const metaRes = await worker.fetch(
        new Request("https://time-to-stable.example.workers.dev/api/meta"),
        env,
        ctx,
      );
      const meta = (await metaRes.json()) as { dataSource: string; manifest: { bcdVersion: string }; history: unknown[] };
      assert.equal(meta.dataSource, "r2");
      assert.equal(meta.manifest.bcdVersion, "99.1.0");
      assert.ok(meta.history.length >= 1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
