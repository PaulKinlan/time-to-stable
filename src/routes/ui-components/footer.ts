import { BrowserName, Browsers } from "../../types.d.ts";
import template from "../../flora.ts";

export default function renderFooter(__meta): ReadableStream<any> {
  return template`<footer><p>Created by <a href="https://paul.kinlan.me">Paul Kinlan</a>. Using <a href="https://github.com/mdn/browser-compat-data">BCD</a> version: ${__meta.version}, updated on ${__meta.timestamp}. Read more about this project in <a href="https://paul.kinlan.me/what-is-new-on-the-web/">this article</a> or view the <a href="https://github.com/paulkinlan/time-to-stable">repository</a>.</p></footer>`;
}
