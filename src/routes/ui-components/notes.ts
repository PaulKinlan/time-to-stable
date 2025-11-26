import template from "../../flora.ts";
import { CompatResult, BrowserName } from "../../types.d.ts";
import { BrowserState } from "../types.d.ts";

/**
 * Renders notes for a feature's browser support.
 * Notes are rendered as a small info section below or beside the feature name.
 */
export function renderFeatureNotes(feature: CompatResult): ReadableStream<any> | string {
  const all = feature.all;
  if (!all) return '';

  const notesHtml: string[] = [];
  
  for (const browser of Object.keys(all) as BrowserName[]) {
    const browserSupport = all[browser];
    if (browserSupport?.notes) {
      const notes = Array.isArray(browserSupport.notes) 
        ? browserSupport.notes 
        : [browserSupport.notes];
      
      for (const note of notes) {
        notesHtml.push(`<small class="note"><strong>${browserSupport.name || browser}:</strong> ${note}</small>`);
      }
    }
  }

  if (notesHtml.length === 0) return '';

  return template`<div class="feature-notes">${notesHtml.join('')}</div>`;
}

/**
 * Checks if a feature has any notes in its browser support data.
 */
export function hasNotes(feature: CompatResult): boolean {
  const all = feature.all;
  if (!all) return false;

  for (const browser of Object.keys(all) as BrowserName[]) {
    const browserSupport = all[browser];
    if (browserSupport?.notes) {
      return true;
    }
  }
  return false;
}
