import { negotiateFormat } from "./analysis/query.ts";
import { DataStore } from "./data/store.ts";
import { runScheduledCheck } from "./data/sync.ts";
import { escapeHtml, htmlResponse } from "./formats/html.ts";
import { jsonResponse } from "./formats/json.ts";
import { markdownResponse } from "./formats/markdown.ts";
import {
  handleLlmsFullTxt,
  handleLlmsTxt,
  handleOpenApiJson,
} from "./routes/agent.ts";
import { handleApiRoute } from "./routes/api.ts";
import { handleBaselineRoute } from "./routes/baseline.ts";
import { handleCompareRoute } from "./routes/compare.ts";
import { handleFeatureRoute } from "./routes/feature.ts";
import { handleIndexRoute } from "./routes/index.ts";
import { handleLifecycleRoute } from "./routes/lifecycle.ts";
import { handleNotStableRoute } from "./routes/not-stable.ts";
import { createRouteContext } from "./routes/shared.ts";
import {
  handleCoreSitemap,
  handleFeaturesSitemap,
  handleRobotsTxt,
  handleSitemapIndex,
} from "./routes/sitemap.ts";
import { handleStoriesRoute } from "./routes/stories.ts";
import { handleWhenStableRoute } from "./routes/when-stable.ts";
import { renderPageLayout } from "./ui/layout.ts";
import type { Env } from "./types.ts";

function buildEtag(
  versionKey: string,
  cacheKeyUrl: string,
  format: string,
): string {
  // Fast deterministic FNV-1a 32-bit hash for strong ETag
  const input = `${versionKey}|${cacheKeyUrl}|${format}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `"${versionKey}-${(h >>> 0).toString(16)}"`;
}

function getDefaultEdgeCache(): Cache | null {
  try {
    if (typeof caches !== "undefined" && caches && "default" in caches) {
      return (caches as unknown as { default: Cache }).default;
    }
  } catch {
    // Node test runtime without global Cache API
  }
  return null;
}

function renderNotFound(
  ctx: Awaited<ReturnType<typeof createRouteContext>>,
  format: string,
): Response {
  const path = ctx.url.pathname;
  if (format === "json") {
    return jsonResponse({ error: "Not found", path }, 404);
  }
  if (format === "md") {
    return markdownResponse(`# 404 Not Found\n\nNo resource at \`${path}\`.\n`, 404);
  }
  const html = renderPageLayout({
    title: "Page Not Found (404)",
    description: "The requested page or feature could not be found.",
    canonicalUrl: `${ctx.origin}${path}`,
    currentPath: path,
    origin: ctx.origin,
    manifest: ctx.manifest,
    dataSource: ctx.dataSource,
    syncStatus: ctx.syncStatus,
    contentHtml: `<header class="page-intro">
      <h1>Page Not Found</h1>
      <p class="page-lead">We could not find <code>${escapeHtml(path)}</code>.</p>
      <p class="not-found-actions"><a class="btn btn-primary" href="/">Return to Time to Stable</a> <a class="btn" href="/stories">Explore Data Stories</a></p>
    </header>`,
  });
  return htmlResponse(html, 404);
}

async function routeRequest(
  request: Request,
  env: Env,
): Promise<{
  response: Response;
  cacheable: boolean;
  manifestKey: string;
  timings: Array<[string, number]>;
}> {
  const ctx = await createRouteContext(request, env);
  const manifestKey = `${ctx.manifest.bcdVersion}-${ctx.manifest.webFeaturesVersion}-${ctx.dataSource}`;
  const path = ctx.url.pathname;
  const format = negotiateFormat(request);
  const tRoute0 = performance.now();

  let response: Response | null = null;
  let cacheable = request.method === "GET" && !path.startsWith("/api/admin/");

  if (path === "/robots.txt") {
    response = handleRobotsTxt(ctx);
  } else if (path === "/llms.txt") {
    response = handleLlmsTxt(ctx);
  } else if (path === "/llms-full.txt") {
    response = await handleLlmsFullTxt(ctx);
  } else if (path === "/openapi.json") {
    response = handleOpenApiJson(ctx);
  } else if (path === "/sitemap.xml") {
    response = handleSitemapIndex(ctx);
  } else if (path === "/sitemaps/core.xml") {
    response = await handleCoreSitemap(ctx);
  } else if (path === "/sitemaps/features.xml") {
    response = await handleFeaturesSitemap(ctx);
  } else if (path === "/") {
    response = await handleIndexRoute(ctx);
  } else if (path === "/not-stable") {
    response = await handleNotStableRoute(ctx);
  } else if (path === "/when-stable") {
    response = await handleWhenStableRoute(ctx);
  } else if (path === "/baseline") {
    response = await handleBaselineRoute(ctx);
  } else if (path === "/experimental") {
    response = await handleLifecycleRoute(ctx, "experimental");
  } else if (path === "/deprecated") {
    response = await handleLifecycleRoute(ctx, "deprecated");
  } else if (path === "/removed") {
    response = await handleLifecycleRoute(ctx, "removed");
  } else if (path === "/all") {
    response = await handleLifecycleRoute(ctx, "all");
  } else if (path === "/stories") {
    response = await handleStoriesRoute(ctx);
  } else if (path.startsWith("/stories/")) {
    const slug = decodeURIComponent(path.slice("/stories/".length));
    response = await handleStoriesRoute(ctx, slug);
  } else if (path.startsWith("/compare/")) {
    const parts = path.slice("/compare/".length).split("/").filter(Boolean);
    if (parts.length >= 1 && parts.length <= 2) {
      response = await handleCompareRoute(
        ctx,
        decodeURIComponent(parts[0]),
        parts[1] ? decodeURIComponent(parts[1]) : undefined,
      );
    }
  } else if (path.startsWith("/feature/")) {
    const id = path.slice("/feature/".length);
    response = await handleFeatureRoute(ctx, id);
  } else if (path.startsWith("/api/")) {
    response = await handleApiRoute(ctx, path);
    if (path.startsWith("/api/admin/") || path === "/api/meta") {
      cacheable = false;
    }
  } else {
    // Fallback to static assets (/styles/*, /scripts/*, /images/*, verification file)
    const assetRes = await env.ASSETS.fetch(request);
    if (assetRes.status !== 404) {
      response = assetRes;
      return {
        response,
        cacheable: false,
        manifestKey,
        timings: ctx.timings,
      };
    }
  }

  if (!response) {
    response = renderNotFound(ctx, format);
    cacheable = false;
  }

  ctx.timings.push([
    "render",
    Math.round((performance.now() - tRoute0) * 10) / 10,
  ]);
  return { response, cacheable, manifestKey, timings: ctx.timings };
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const reqUrl = new URL(request.url);
    const canonicalHost = env.CANONICAL_HOST?.trim();
    const redirectHosts = (env.REDIRECT_HOSTS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (
      canonicalHost &&
      redirectHosts.includes(reqUrl.hostname) &&
      reqUrl.hostname !== canonicalHost
    ) {
      reqUrl.protocol = "https:";
      reqUrl.hostname = canonicalHost;
      reqUrl.port = "";
      return Response.redirect(reqUrl.toString(), 301);
    }

    const format = negotiateFormat(request);
    const edgeCache = getDefaultEdgeCache();
    const isGet = request.method === "GET";
    const isAdmin = reqUrl.pathname.startsWith("/api/admin/");

    // Static assets shortcut before Worker data loading when clearly an asset extension
    if (
      isGet &&
      (reqUrl.pathname.startsWith("/styles/") ||
        reqUrl.pathname.startsWith("/scripts/") ||
        reqUrl.pathname.startsWith("/images/") ||
        reqUrl.pathname === "/google1bf7ef037ae116eb.html")
    ) {
      const assetRes = await env.ASSETS.fetch(request);
      if (assetRes.status !== 404) {
        return assetRes;
      }
    }

    const isUncachedRoute =
      isAdmin || reqUrl.pathname === "/api/meta";
    let versionKey = "";

    if (edgeCache && isGet && !isUncachedRoute) {
      try {
        const { manifest, source } = await new DataStore(
          env,
        ).getManifestWithSource();
        versionKey = `${manifest.bcdVersion}-${manifest.webFeaturesVersion}-${source}`;
        const cacheUrl = new URL(reqUrl.toString());
        cacheUrl.searchParams.set("__fmt", format);
        cacheUrl.searchParams.set("__ver", versionKey);
        const cached = await edgeCache.match(new Request(cacheUrl.toString()));
        if (cached) {
          const ifNoneMatch = request.headers.get("if-none-match");
          const cachedEtag = cached.headers.get("etag");
          if (ifNoneMatch && cachedEtag && ifNoneMatch === cachedEtag) {
            return new Response(null, { status: 304, headers: cached.headers });
          }
          return cached;
        }
      } catch {
        // fall through to normal routing
      }
    }

    const { response, cacheable, manifestKey, timings } = await routeRequest(
      request,
      env,
    );

    const headers = new Headers(response.headers);
    headers.append(
      "Server-Timing",
      timings.map(([k, v]) => `${k};dur=${v}`).join(", "),
    );
    headers.set("Vary", "Accept");
    headers.set(
      "Link",
      `</llms.txt>; rel="describedby"; type="text/markdown"`,
    );
    headers.set("X-Content-Type-Options", "nosniff");

    if (cacheable && response.status === 200) {
      const etag = buildEtag(manifestKey, reqUrl.toString(), format);
      headers.set("ETag", etag);
      if (!headers.has("Cache-Control")) {
        headers.set(
          "Cache-Control",
          "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
        );
      }

      const ifNoneMatch = request.headers.get("if-none-match");
      if (ifNoneMatch && ifNoneMatch === etag) {
        return new Response(null, { status: 304, headers });
      }

      const finalResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });

      if (edgeCache && !reqUrl.pathname.startsWith("/data/")) {
        const cacheUrl = new URL(reqUrl.toString());
        cacheUrl.searchParams.set("__fmt", format);
        cacheUrl.searchParams.set("__ver", versionKey || manifestKey);
        ctx.waitUntil(
          edgeCache.put(new Request(cacheUrl.toString()), finalResponse.clone()),
        );
      }

      return finalResponse;
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runScheduledCheck(env));
  },
};
