# Time to Stable

Measure how long web platform features take to ship across browsers — powered by **MDN Browser Compat Data (`@mdn/browser-compat-data`)** and **W3C WebDX (`web-features` / Baseline)** running 100% on **Cloudflare Workers + Static Assets + R2 + Cron Triggers**.

- **Live site**: [https://timetostable.com](https://timetostable.com)
- **Introductory essay**: [What is new on the web?](https://paul.kinlan.me/what-is-new-on-the-web/)

---

## Key Capabilities

- **Zero runtime npm dependencies & zero GitHub automation overhead**: Pure TypeScript Cloudflare Worker, self-hosted CSS/JS, inline SVG charts, and self-contained Cloudflare Cron data syncing into R2.
- **Self-Updating Data Pipeline on Cloudflare**:
  - The Worker Cron Trigger (`0 */6 * * *`) checks npm for new `@mdn/browser-compat-data` and `web-features` releases.
  - When a new release appears, the Worker streams `data.json` in a bounded 2-pass streaming scanner (`src/data/stream-bcd.ts`), compiles compact category shards + `precomputed.json`, writes them directly to R2 (`time-to-stable-data`), records a release snapshot in `history.json`, and invalidates isolate caches — with zero redeploys and zero GitHub Actions.
- **Principled Statistical Engine**:
  - Reports **median**, **IQR (p25–p75)**, **p90**, **mean**, and **fast-follow share (≤30d)** to counter extreme right-skew.
  - Flags recent yearly cohorts with `<80%` completion as **right-censored** and computes **Kaplan–Meier survival probabilities** (1y, 2y, 5y) incorporating still-waiting features.
  - Supports strictness controls (`exclude-partial`, `include-prefixed`, `include-flagged`) and dual granularity (**BCD Keys** vs. **WebDX Web Features / Baseline**).
- **Seven Pre-Computed Editorial Data Stories** (`/stories`):
  1. *Is the Web Reaching Stability Faster?* (Kaplan–Meier multi-era convergence)
  2. *The Lumpy Web* ("One Browser Away" holdouts & single-engine exclusives)
  3. *The Mobile Parity Gap* (Desktop vs. Android, iOS & WebViews)
  4. *The Long Tail* (Marathons, coordinated sprints & eternal limbo)
  5. *Platform Velocity* (CSS vs. JS vs. HTML vs. DOM API vs. WebAssembly)
  6. *Baseline Momentum* (Newly Available waves & upcoming 30-month Widely Available graduations)
  7. *The Web Rarely Forgets* (Deprecated "zombie" APIs vs. full cross-engine removals)
- **Agentic Web Ready**:
  - `/llms.txt`, `/llms-full.txt`, and `/openapi.json` (OpenAPI 3.1)
  - Content negotiation (`Accept: text/markdown` or `?type=md`) on every page
  - JSON APIs (`/api/meta`, `/api/compare`, `/api/stats`, `/api/features`, `/api/feature/:id`, `/api/stories`)
  - Progressive **WebMCP** (`navigator.modelContext`) tool registration
- **Search Discoverability & Performance**:
  - Clean indexable URLs (`/compare/:slug`, `/stories/:slug`, `/feature/:id`)
  - Schema.org JSON-LD (`WebSite`, `Dataset`, `Article`, `BreadcrumbList`)
  - Split XML sitemaps (`/sitemap.xml` -> `/sitemaps/core.xml` + `/sitemaps/features.xml`) and `/robots.txt`
  - Build-time `precomputed.json` + lazy multi-shard BCD loading + Cloudflare Edge Cache (`ETag` / `304`)

---

## Local Development

Requires **Node.js 24+** (uses native TypeScript execution).

```sh
npm install
npm run build:data
npm run typecheck
npm test
npm run dev
```

`npm run dev` starts `wrangler dev` locally (default `http://localhost:8787`). When R2 is empty locally, the Worker seamlessly falls back to the compiled data shards in `public/data/`.

To test the Cloudflare Cron Trigger locally:

```sh
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled"
```

---

## Cloudflare Provisioning & Deployment

1. **Create the R2 bucket** (once):
   ```sh
   npx wrangler r2 bucket create time-to-stable-data
   ```
2. **Deploy Worker, Static Assets & 6-hour Cron Trigger**:
   ```sh
   npm run deploy
   ```
3. **Configuration (`wrangler.jsonc`) & Secrets**:
   - `CANONICAL_HOST`: Set to `timetostable.com` (empty falls back to the incoming request host). `http://` requests to `CANONICAL_HOST` upgrade to `https://`.
   - `REDIRECT_HOSTS`: Comma-separated legacy/preview hosts (`*.deno.dev`, `*.workers.dev`, `www.timetostable.com`) that `301`/`308`-redirect to `CANONICAL_HOST` preserving path and query.
   - `routes` is intentionally omitted from `wrangler.jsonc` so Custom Domains attached in the Cloudflare Dashboard remain untouched by `wrangler deploy` and Cloudflare Workers Builds.
   - `DATA_SOURCE_URL` *(optional)*: Direct shard mirror URL if overriding the default npm/CDN streaming self-sync.
   - `SYNC_SECRET` *(optional Worker secret via `npx wrangler secret put SYNC_SECRET`)*: Bearer token authorizing `POST /api/admin/refresh`, `POST /api/admin/check`, and `POST /api/admin/sync`. Remove `SYNC_SECRET` via `npx wrangler secret delete SYNC_SECRET` to disable all HTTP `/api/admin/*` endpoints while keeping the 6-hour Cloudflare Cron Trigger active.
4. **Git Deployments (Cloudflare Workers Builds)**:
   When connected in the Cloudflare Dashboard via **Workers Builds**, pushes to `main` redeploy Worker code and static assets (`npm run deploy` runs `npm run build:data && wrangler deploy`), while the 6-hour Cron Trigger keeps R2 data updated autonomously without needing commits.
