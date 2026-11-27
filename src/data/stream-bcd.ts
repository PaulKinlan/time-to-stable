import { CATEGORIES } from "../analysis/query.ts";
import {
  buildPrecomputedAndManifest,
  compileBrowsersMeta,
  compileWebFeatures,
  extractCompactFeaturesFromNode,
  getOrderedBrowserIds,
  shardCategoryFeatures,
  type RawBcdMeta,
  type RawBrowser,
  type RawWebFeaturesBundle,
} from "./compiler.ts";
import type {
  BrowserMeta,
  CategoryShardMeta,
  CategorySlug,
  CompactFeature,
  CompactWebFeature,
  HistorySnapshot,
  Manifest,
  PrecomputedData,
} from "../types.ts";

export type SubtreeDecision = "capture" | "descend" | "skip" | "stop";

interface ObjFrame {
  path: string[];
  state:
    | "expect_key_or_end"
    | "reading_key"
    | "expect_colon"
    | "expect_value"
    | "expect_comma_or_end";
}

function isWs(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

/**
 * Streams a top-level JSON object and extracts only requested subtrees,
 * skipping ignored subtrees with zero allocation and releasing each captured
 * subtree immediately after `onValue` completes.
 */
export async function streamJsonSubtrees(
  stream: ReadableStream<Uint8Array>,
  onDecide: (path: readonly string[]) => SubtreeDecision,
  onValue: (
    path: readonly string[],
    value: unknown,
  ) => Promise<SubtreeDecision | void> | SubtreeDecision | void,
  onObjectEnd?: (
    path: readonly string[],
  ) => Promise<SubtreeDecision | void> | SubtreeDecision | void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");

  let mode: "root" | "obj" | "capture" | "skip" | "skip_str" | "skip_prim" =
    "root";
  const frames: ObjFrame[] = [];

  let keyChunks: string[] = [];
  let keyStart = 0;
  let currentKey = "";
  let keyEsc = false;

  let subDepth = 0;
  let subInStr = false;
  let subEsc = false;

  let capChunks: string[] = [];
  let capStart = 0;
  let capPath: string[] = [];

  let primEsc = false;
  let stopped = false;

  const stopReader = async () => {
    stopped = true;
    try {
      await reader.cancel();
    } catch {
      // ignore cancel errors
    }
  };

  try {
    while (!stopped) {
      const { done, value } = await reader.read();
      const chunk = done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });

      if (chunk.length > 0) {
        let i = 0;
        if (mode === "capture") capStart = 0;
        if (
          mode === "obj" &&
          frames.length > 0 &&
          frames[frames.length - 1].state === "reading_key"
        ) {
          keyStart = 0;
        }

        while (i < chunk.length && !stopped) {
          if (mode === "capture") {
            let ended = false;
            while (i < chunk.length) {
              const code = chunk.charCodeAt(i);
              if (subInStr) {
                if (subEsc) subEsc = false;
                else if (code === 92) subEsc = true;
                else if (code === 34) subInStr = false;
              } else {
                if (code === 34) {
                  subInStr = true;
                } else if (code === 123 || code === 91) {
                  subDepth++;
                } else if (code === 125 || code === 93) {
                  subDepth--;
                  if (subDepth === 0) {
                    capChunks.push(chunk.slice(capStart, i + 1));
                    const rawJson = capChunks.join("");
                    capChunks = [];
                    const parsed = JSON.parse(rawJson);
                    const res = await onValue(capPath, parsed);
                    if (res === "stop") {
                      await stopReader();
                      return;
                    }
                    frames[frames.length - 1].state = "expect_comma_or_end";
                    mode = "obj";
                    i++;
                    ended = true;
                    break;
                  }
                }
              }
              i++;
            }
            if (!ended && capStart < chunk.length) {
              capChunks.push(chunk.slice(capStart));
            }
            continue;
          }

          if (mode === "skip") {
            while (i < chunk.length) {
              const code = chunk.charCodeAt(i);
              if (subInStr) {
                if (subEsc) subEsc = false;
                else if (code === 92) subEsc = true;
                else if (code === 34) subInStr = false;
              } else {
                if (code === 34) {
                  subInStr = true;
                } else if (code === 123 || code === 91) {
                  subDepth++;
                } else if (code === 125 || code === 93) {
                  subDepth--;
                  if (subDepth === 0) {
                    frames[frames.length - 1].state = "expect_comma_or_end";
                    mode = "obj";
                    i++;
                    break;
                  }
                }
              }
              i++;
            }
            continue;
          }

          if (mode === "skip_str") {
            while (i < chunk.length) {
              const code = chunk.charCodeAt(i);
              if (primEsc) primEsc = false;
              else if (code === 92) primEsc = true;
              else if (code === 34) {
                frames[frames.length - 1].state = "expect_comma_or_end";
                mode = "obj";
                i++;
                break;
              }
              i++;
            }
            continue;
          }

          if (mode === "skip_prim") {
            while (i < chunk.length) {
              const code = chunk.charCodeAt(i);
              if (code === 44) {
                frames[frames.length - 1].state = "expect_key_or_end";
                mode = "obj";
                i++;
                break;
              }
              if (code === 125 || isWs(code)) {
                frames[frames.length - 1].state = "expect_comma_or_end";
                mode = "obj";
                break;
              }
              i++;
            }
            continue;
          }

          const code = chunk.charCodeAt(i);

          if (mode === "root") {
            if (isWs(code) || code === 0xfeff) {
              i++;
              continue;
            }
            if (code === 123) {
              frames.push({ path: [], state: "expect_key_or_end" });
              mode = "obj";
              i++;
              continue;
            }
            throw new Error(`Expected JSON object root, saw charCode ${code}`);
          }

          // mode === "obj"
          const frame = frames[frames.length - 1];
          if (frame.state === "expect_key_or_end") {
            if (isWs(code)) {
              i++;
              continue;
            }
            if (code === 34) {
              frame.state = "reading_key";
              keyChunks = [];
              keyStart = i + 1;
              keyEsc = false;
              i++;
              continue;
            }
            if (code === 125) {
              const popped = frames.pop()!;
              const endRes = await onObjectEnd?.(popped.path);
              if (endRes === "stop" || frames.length === 0) {
                await stopReader();
                return;
              }
              frames[frames.length - 1].state = "expect_comma_or_end";
              i++;
              continue;
            }
            throw new Error(
              `Unexpected charCode ${code} expecting key or } at ${frame.path.join(".")}`,
            );
          }

          if (frame.state === "reading_key") {
            let foundEnd = false;
            while (i < chunk.length) {
              const kCode = chunk.charCodeAt(i);
              if (keyEsc) {
                keyEsc = false;
              } else if (kCode === 92) {
                keyEsc = true;
              } else if (kCode === 34) {
                keyChunks.push(chunk.slice(keyStart, i));
                const rawKey = keyChunks.join("");
                currentKey = rawKey.includes("\\")
                  ? (JSON.parse(`"${rawKey}"`) as string)
                  : rawKey;
                keyChunks = [];
                frame.state = "expect_colon";
                i++;
                foundEnd = true;
                break;
              }
              i++;
            }
            if (!foundEnd && keyStart < chunk.length) {
              keyChunks.push(chunk.slice(keyStart));
            }
            continue;
          }

          if (frame.state === "expect_colon") {
            if (isWs(code)) {
              i++;
              continue;
            }
            if (code === 58) {
              frame.state = "expect_value";
              i++;
              continue;
            }
            throw new Error(`Expected ':' after key ${currentKey}, saw ${code}`);
          }

          if (frame.state === "expect_value") {
            if (isWs(code)) {
              i++;
              continue;
            }
            const childPath = [...frame.path, currentKey];
            if (code === 123 || code === 91) {
              const decision = onDecide(childPath);
              if (decision === "stop") {
                await stopReader();
                return;
              }
              if (decision === "descend" && code === 123) {
                frames.push({ path: childPath, state: "expect_key_or_end" });
                i++;
                continue;
              }
              if (decision === "capture") {
                mode = "capture";
                subDepth = 1;
                subInStr = false;
                subEsc = false;
                capChunks = [chunk[i]];
                capStart = i + 1;
                capPath = childPath;
                i++;
                continue;
              }
              mode = "skip";
              subDepth = 1;
              subInStr = false;
              subEsc = false;
              i++;
              continue;
            }
            if (code === 34) {
              mode = "skip_str";
              primEsc = false;
              i++;
              continue;
            }
            mode = "skip_prim";
            continue;
          }

          if (frame.state === "expect_comma_or_end") {
            if (isWs(code)) {
              i++;
              continue;
            }
            if (code === 44) {
              frame.state = "expect_key_or_end";
              i++;
              continue;
            }
            if (code === 125) {
              frame.state = "expect_key_or_end";
              continue;
            }
            throw new Error(
              `Expected ',' or '}' after ${currentKey}, saw ${code}`,
            );
          }
        }
      }

      if (done) break;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore if already released
    }
  }
}

export interface StreamCompileResult {
  manifest: Manifest;
  precomputed: PrecomputedData;
  historySnapshot: HistorySnapshot;
  shardCount: number;
}

/**
 * Compiles BCD + web-features using a 2-pass streaming JSON scanner over BCD
 * so peak memory stays well under Cloudflare Workers' 128 MB isolate limit.
 */
export async function streamCompileBcd(opts: {
  openBcdStream: () => Promise<ReadableStream<Uint8Array>>;
  rawWfData: RawWebFeaturesBundle;
  webFeaturesVersion: string;
  onShardWrite: (file: string, json: string) => Promise<void>;
  existingHistory?: HistorySnapshot[];
}): Promise<StreamCompileResult> {
  const {
    openBcdStream,
    rawWfData,
    webFeaturesVersion,
    onShardWrite,
    existingHistory,
  } = opts;

  let bcdMeta: RawBcdMeta | null = null;
  let rawBrowsers: Record<string, RawBrowser> | null = null;
  let orderedIds: string[] = [];
  let browsersMeta: BrowserMeta[] = [];
  let webFeatures: CompactWebFeature[] = [];
  let bcdToWf = new Map<string, CompactWebFeature>();

  const pendingPass1Nodes: Array<{
    cat: CategorySlug;
    basePath: string;
    node: unknown;
  }> = [];

  const counts = {} as Record<CategorySlug, number>;
  const categoryShards = {} as Record<CategorySlug, CategoryShardMeta[]>;
  const shardFiles: string[] = [];
  const allBcdFeatures: CompactFeature[] = [];

  const catBuffers: Record<CategorySlug, CompactFeature[]> = {
    api: [],
    css: [],
    html: [],
    http: [],
    javascript: [],
    webassembly: [],
  };

  let shardWriteCount = 0;

  async function flushCategory(cat: CategorySlug) {
    const items = catBuffers[cat];
    catBuffers[cat] = [];
    counts[cat] = items.length;
    const { shardsMeta, shardPayloads } = shardCategoryFeatures(cat, items);
    categoryShards[cat] = shardsMeta;
    for (const payload of shardPayloads) {
      await onShardWrite(`current/${payload.file}`, payload.json);
      shardFiles.push(payload.file);
      shardWriteCount++;
    }
    allBcdFeatures.push(...items);
  }

  function processSubtree(cat: CategorySlug, basePath: string, node: unknown) {
    if (!rawBrowsers) {
      pendingPass1Nodes.push({ cat, basePath, node });
      return;
    }
    const extracted = extractCompactFeaturesFromNode(
      node,
      basePath,
      cat,
      orderedIds,
      rawBrowsers,
      bcdToWf,
    );
    catBuffers[cat].push(...extracted);
  }

  // Pass 1: capture __meta, browsers, and css/html/http/javascript/webassembly (skip api)
  const pass1Stream = await openBcdStream();
  await streamJsonSubtrees(
    pass1Stream,
    (path) => {
      if (path.length === 1) {
        const top = path[0];
        if (top === "__meta" || top === "browsers") return "capture";
        if (
          top === "css" ||
          top === "html" ||
          top === "http" ||
          top === "javascript" ||
          top === "webassembly"
        ) {
          return "descend";
        }
        return "skip";
      }
      if (path.length === 2) {
        const [top, child] = path;
        if (
          (top === "css" && child === "properties") ||
          (top === "javascript" && child === "builtins") ||
          (top === "html" && child === "elements")
        ) {
          return "descend";
        }
        if (child.startsWith("__")) return "skip";
        return "capture";
      }
      if (path.length === 3) {
        return path[2].startsWith("__") ? "skip" : "capture";
      }
      return "skip";
    },
    async (path, value) => {
      const top = path[0];
      if (top === "__meta") {
        bcdMeta = value as RawBcdMeta;
        return;
      }
      if (top === "browsers") {
        rawBrowsers = value as Record<string, RawBrowser>;
        orderedIds = getOrderedBrowserIds(rawBrowsers);
        browsersMeta = compileBrowsersMeta(rawBrowsers);
        const compiledWf = compileWebFeatures(rawWfData, rawBrowsers);
        webFeatures = compiledWf.webFeatures;
        bcdToWf = compiledWf.bcdToWf;

        await onShardWrite("current/browsers.json", JSON.stringify(browsersMeta));
        shardWriteCount++;
        await onShardWrite(
          "current/web-features.json",
          JSON.stringify(webFeatures),
        );
        shardWriteCount++;

        for (const pending of pendingPass1Nodes.splice(0)) {
          processSubtree(pending.cat, pending.basePath, pending.node);
        }
        return;
      }

      if (
        top === "css" ||
        top === "html" ||
        top === "http" ||
        top === "javascript" ||
        top === "webassembly"
      ) {
        processSubtree(top, path.join("."), value);
      }
    },
    async (path) => {
      if (path.length === 1) {
        const top = path[0];
        if (
          top === "css" ||
          top === "html" ||
          top === "http" ||
          top === "javascript" ||
          top === "webassembly"
        ) {
          await flushCategory(top);
        }
      }
    },
  );

  if (!bcdMeta || !rawBrowsers) {
    throw new Error("BCD stream missing __meta or browsers section");
  }

  // Pass 2: stream "api" interface-by-interface, then stop immediately when "api" closes
  const pass2Stream = await openBcdStream();
  await streamJsonSubtrees(
    pass2Stream,
    (path) => {
      if (path.length === 1) {
        return path[0] === "api" ? "descend" : "skip";
      }
      if (path.length === 2 && path[0] === "api") {
        return path[1].startsWith("__") ? "skip" : "capture";
      }
      return "skip";
    },
    async (path, value) => {
      if (path[0] === "api") {
        processSubtree("api", path.join("."), value);
      }
    },
    async (path) => {
      if (path.length === 1 && path[0] === "api") {
        await flushCategory("api");
        return "stop";
      }
    },
  );

  // Drop heavy raw browser release maps before computing stories/presets
  rawBrowsers = null;
  bcdToWf = new Map();

  for (const cat of CATEGORIES) {
    if (!categoryShards[cat]) {
      await flushCategory(cat);
    }
  }

  const { manifest, precomputed, historySnapshot, historySeed } =
    buildPrecomputedAndManifest({
      bcdMeta,
      webFeaturesVersion,
      browsersMeta,
      allBcdFeatures,
      webFeatures,
      counts,
      categoryShards,
      shardFiles,
      existingHistory,
    });

  await onShardWrite("current/precomputed.json", JSON.stringify(precomputed));
  shardWriteCount++;
  await onShardWrite(
    "current/history-seed.json",
    JSON.stringify(historySeed, null, 2),
  );
  shardWriteCount++;

  const manifestJson = JSON.stringify(manifest, null, 2);
  await onShardWrite(
    `snapshots/${manifest.bcdVersion}/manifest.json`,
    manifestJson,
  );
  await onShardWrite("current/manifest.json", manifestJson);
  shardWriteCount += 2;

  return {
    manifest,
    precomputed,
    historySnapshot,
    shardCount: shardWriteCount,
  };
}
