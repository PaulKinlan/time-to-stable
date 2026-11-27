export function escapeHtml(str: unknown): string {
  const s = str === null || str === undefined ? "" : String(str);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitizes HTML strings from MDN BCD notes while preserving safe inline markup
 * such as <code>, <a>, <strong>, <em>, <abbr>.
 */
export function sanitizeNoteHtml(raw: string): string {
  return raw
    .replace(/<\s*(script|iframe|object|embed|style|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|object|embed|style)[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(['"])\s*(?:javascript|data|vbscript):[^'"]*\2/gi, '$1="#"');
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
}
