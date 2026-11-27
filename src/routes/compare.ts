import { CATEGORY_LABELS, parseCompareSlug } from "../analysis/query.ts";
import { handleIndexRoute } from "./index.ts";
import { handleNotStableRoute } from "./not-stable.ts";
import { handleWhenStableRoute } from "./when-stable.ts";
import type { RouteContext } from "./shared.ts";

export async function handleCompareRoute(
  ctx: RouteContext,
  slug: string,
  sub?: string,
): Promise<Response | null> {
  const parsed = parseCompareSlug(slug, sub);
  if (!parsed) return null;

  const validSet = new Set(ctx.browsers.map((b) => b.id));
  const validBrowsers = parsed.browsers.filter((b) => validSet.has(b));
  if (validBrowsers.length < 2) return null;

  const actionPath = sub ? `/compare/${slug}/${sub}` : `/compare/${slug}`;
  const breadcrumbs = [
    { label: "Home", href: "/" },
    {
      label: validBrowsers
        .map((id) => ctx.browsers.find((b) => b.id === id)?.shortName ?? id)
        .join(" vs "),
      href: sub ? `/compare/${slug}` : undefined,
    },
    ...(sub
      ? [
          {
            label:
              sub === "not-stable"
                ? "Not Yet Stable"
                : sub === "when-stable"
                ? "Now Stable"
                : sub === "all"
                ? "All Areas"
                : CATEGORY_LABELS[parsed.categories[0]] ?? sub,
          },
        ]
      : []),
  ];

  if (parsed.viewOverride === "not-stable") {
    return handleNotStableRoute(ctx, {
      actionPath,
      slugBrowsers: validBrowsers,
      slugCategories: parsed.categories,
      breadcrumbs,
    });
  }

  if (parsed.viewOverride === "when-stable") {
    return handleWhenStableRoute(ctx, {
      actionPath,
      slugBrowsers: validBrowsers,
      slugCategories: parsed.categories,
      breadcrumbs,
    });
  }

  return handleIndexRoute(ctx, {
    actionPath,
    slugBrowsers: validBrowsers,
    slugCategories: parsed.categories,
    breadcrumbs,
  });
}
