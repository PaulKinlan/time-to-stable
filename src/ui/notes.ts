import { escapeHtml, sanitizeNoteHtml } from "../formats/html.ts";
import type { BrowserMeta, CompactNote } from "../types.ts";

function shortBrowser(id: string, browsers: readonly BrowserMeta[]): string {
  return browsers.find((b) => b.id === id)?.shortName ?? id;
}

export function renderCompactNotes(
  notes: readonly CompactNote[] | undefined,
  browsers: readonly BrowserMeta[],
): string {
  if (!notes || notes.length === 0) return "";

  const items = notes
    .map((n) => {
      const label = n.b.map((b) => shortBrowser(b, browsers)).join(", ");
      const safeHtml = sanitizeNoteHtml(n.t);
      return `<small class="note"><strong>${escapeHtml(label)}:</strong> ${safeHtml}</small>`;
    })
    .join("");

  if (notes.length > 1 || items.length > 220) {
    return `<details class="feature-notes"><summary>Notes (${notes.length})</summary>${items}</details>`;
  }

  return `<div class="feature-notes">${items}</div>`;
}
