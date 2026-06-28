// Use the native Deno.serve (the pattern the new Deno Deploy expects — it
// auto-binds to the platform-assigned port) instead of the deprecated
// std@0.152 http `serve`, which hardcoded :8000.
import { join } from "https://deno.land/std@0.152.0/path/mod.ts";
import { contentType } from "https://deno.land/std@0.152.0/media_types/mod.ts";

// @deno-types="https://esm.sh/@mdn/browser-compat-data@5.6.35/types.d.ts"
// Import via esm.sh (in Deno's default --allow-import allowlist) instead of
// unpkg.com (which is NOT, so the new Deno Deploy build failed with "Requires
// import access to unpkg.com"). esm.sh serves it as an ES module whose default
// export is the compat-data object, so no `with { type: "json" }` is needed.
import bcd from "https://esm.sh/@mdn/browser-compat-data@5.6.35";


import index from "./src/routes/index.ts";
import notStable from "./src/routes/not-stable.ts";
import when from "./src/routes/when.ts";
import deprecated from "./src/routes/deprecated.ts";
import experimental from "./src/routes/experimental.ts";
import all from "./src/routes/all.ts";
import removed from "./src/routes/removed.ts";
import sitemap from "./src/routes/sitemap.ts";
import { Route } from "./types/types.d.ts";
// Init

delete bcd.webextensions;
delete bcd.webdriver;
delete bcd.svg;
delete bcd.mathml;

class StaticFileHandler {
  #basePath = "";

  constructor(base: string) {
    this.#basePath = base;
  }

  handler(request: Request): Promise<Response> | Response {
    const pathname = new URL(request.url).pathname;
    const extension = pathname.substr(pathname.lastIndexOf("."));
    const resolvedPathname = (pathname == "" || pathname == "/")
      ? "/index.html"
      : pathname;
    const path = join(Deno.cwd(), this.#basePath, resolvedPathname);
    const file: Promise<Response> = Deno.readFile(path)
      .then((data): Response =>
        new Response(data, {
          status: 200,
          headers: { "content-type": contentType(extension) },
        })
      ) // Need to think about content tyoes.
      .catch((_): Response => new Response("Not found", { status: 404 }));

    return file;
  }

  get pattern(): URLPattern {
    return new URLPattern({ pathname: "*" });
  }
}

// Canonicalize onto the new Deno Deploy host: legacy URLs 301 to the new site
// (path + query preserved), and HTML pages also carry a <link rel="canonical">.
const CANONICAL_HOST = "time-to-stable.paulkinlan-ea.deno.net";
const OLD_HOST = "time-to-stable.deno.dev";

Deno.serve(async (req: Request) => {
  const reqUrl = new URL(req.url);
  // 301 the old/classic host to the new one, preserving the path + query so
  // every old URL lands on its exact new-site equivalent.
  if (reqUrl.hostname === OLD_HOST) {
    reqUrl.protocol = "https:";
    reqUrl.hostname = CANONICAL_HOST;
    reqUrl.port = "";
    return Response.redirect(reqUrl.toString(), 301);
  }

  const url = req.url;
  const staticFiles = new StaticFileHandler("static");
  let response: Response | Promise<Response> = new Response("Not found", { status: 404 });

  const routes: Array<Route> = [
    [
      new URLPattern({ pathname: "/" }),
      (request) => {
        return index(request, bcd);
      },
    ],
    [
      new URLPattern({ pathname: "/not-stable" }),
      (request) => {
        return notStable(request, bcd);
      },
    ],
    [
      new URLPattern({ pathname: "/deprecated" }),
      (request) => {
        return deprecated(request, bcd);
      },
    ],
    [
      new URLPattern({ pathname: "/experimental" }),
      (request) => {
        return experimental(request, bcd);
      },
    ],
    [
      new URLPattern({ pathname: "/when-stable" }),
      (request) => {
        return when(request, bcd);
      },
    ],
    [
      new URLPattern({ pathname: "/removed" }),
      (request) => {
        return removed(request, bcd);
      },
    ],
    [
      new URLPattern({ pathname: "/all" }),
      (request) => {
        return all(request, bcd);
      },
    ],
    [
      new URLPattern({ pathname: "/sitemap.xml" }),
      (request) => {
        return sitemap(request, bcd);
      },
    ],
    // Fall through.
    [
      staticFiles.pattern,
      staticFiles.handler.bind(staticFiles),
    ],
  ];

  for (const [pattern, handler] of routes) {
    const patternResult = pattern.exec(url);
    if (patternResult != null) {
      // Find the first matching route.
      response = handler(req);
      break;
    }
  }

  const res = await response;

  // Point every HTML page's canonical at the new-site URL (same path + query).
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    const canonical = `https://${CANONICAL_HOST}${reqUrl.pathname}${reqUrl.search}`;
    const linkTag = `<link rel="canonical" href="${canonical}">`;
    const body = await res.text();
    const withCanonical = body.includes("</head>")
      ? body.replace("</head>", `${linkTag}</head>`)
      : `${linkTag}${body}`;
    const headers = new Headers(res.headers);
    headers.delete("content-length"); // body length changed
    return new Response(withCanonical, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }

  return res;
});
