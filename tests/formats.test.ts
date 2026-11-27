import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { serializeCsv } from "../src/formats/csv.ts";
import { escapeHtml, sanitizeNoteHtml } from "../src/formats/html.ts";
import { storyToMarkdown } from "../src/formats/markdown.ts";
import { buildRssFeed } from "../src/formats/rss.ts";
import type { Manifest, StoryPayload } from "../src/types.ts";

describe("format serializers and sanitizers", () => {
  it("serializes RFC-4180 CSV with proper quoting", () => {
    const csv = serializeCsv(
      ["API", "Notes"],
      [
        ['api.Foo"Bar', "Contains, comma"],
        ["api.Baz", "Line1\nLine2"],
      ],
    );
    assert.equal(
      csv,
      'API,Notes\n"api.Foo""Bar","Contains, comma"\napi.Baz,"Line1\nLine2"\n',
    );
  });

  it("builds valid RSS 2.0 XML with escaped metadata and safe CDATA", () => {
    const res = buildRssFeed({
      title: "Now Stable <Chrome & Safari>",
      description: 'Desc with "quotes"',
      link: "https://example.com/when-stable",
      selfLink: "https://example.com/when-stable?type=rss&a=1",
      updatedIso: "2025-07-04T00:00:00Z",
      items: [
        {
          title: "2025-07",
          id: "id-1",
          link: "https://example.com/#2025-07",
          pubDateIso: "2025-07-01T00:00:00Z",
          htmlContent: "<p>Hello ]]> world</p>",
        },
      ],
    });

    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type")?.includes("application/rss+xml"));
  });

  it("escapes HTML and sanitizes unsafe markup in notes while preserving safe tags", async () => {
    assert.equal(escapeHtml('<script>"test"</script>'), "&lt;script&gt;&quot;test&quot;&lt;/script&gt;");
    const sanitized = sanitizeNoteHtml(
      'Supported via <code>foo()</code> <a href="javascript:alert(1)" onclick="evil()">bad</a><script>alert(1)</script>',
    );
    assert.ok(sanitized.includes("<code>foo()</code>"));
    assert.ok(!sanitized.includes("<script>"));
    assert.ok(!sanitized.includes("onclick"));
    assert.ok(!sanitized.includes("javascript:"));
  });

  it("formats stories into frontmatter Markdown", () => {
    const manifest: Manifest = {
      schemaVersion: 2,
      generatedAt: "2025-07-04T00:00:00Z",
      bcdVersion: "6.0.29",
      bcdTimestamp: "2025-07-04T17:23:09Z",
      bcdEpochDay: 20273,
      webFeaturesVersion: "2.40.1",
      counts: { api: 1, css: 1, html: 1, http: 1, javascript: 1, webassembly: 1 },
      categoryShards: { api: [], css: [], html: [], http: [], javascript: [], webassembly: [] },
      files: [],
      webFeatureCount: 1,
      categories: ["api", "css", "html", "http", "javascript", "webassembly"],
    };
    const story: StoryPayload = {
      slug: "test-story",
      title: "Test Story",
      subtitle: "Subtitle",
      categoryTag: "Tag",
      summary: "Summary text",
      methodology: "Method",
      keyTakeaways: ["Takeaway A"],
      metrics: [{ label: "Metric", value: "42%" }],
      tables: [{ title: "Table 1", columns: ["Col A", "Col B"], rows: [["x", "y|z"]] }],
    };

    const md = storyToMarkdown(story, "https://example.com/stories/test-story", manifest);
    assert.ok(md.includes('slug: "test-story"'));
    assert.ok(md.includes("# Test Story"));
    assert.ok(md.includes("| x | y\\|z |"));
  });
});
