import { CATEGORIES } from "../analysis/query.ts";
import { getHistorySnapshots } from "./history.ts";
import type {
  BrowserMeta,
  CategorySlug,
  CompactFeature,
  CompactWebFeature,
  Env,
  FeatureLookupResult,
  HistorySnapshot,
  Manifest,
  PrecomputedData,
  SyncStatus,
} from "../types.ts";

interface CacheEntry {
  value: unknown;
  source: "r2" | "bundled";
  versionTag: string;
  expiresAt: number;
}

const MEMORY_TTL_MS = 10 * 60 * 1000;
const MANIFEST_TTL_MS = 60 * 1000;
const isolateCache = new Map<string, CacheEntry>();

export function invalidateDataCache(): void {
  isolateCache.clear();
}

function getBucketCacheKey(env: Env): string {
  // Isolate cache key namespace so distinct mock envs in tests don't collide
  return env.CANONICAL_HOST || env.SYNC_SECRET || "default";
}

export class DataStore {
  env: Env;
  namespace: string;

  constructor(env: Env, namespace?: string) {
    this.env = env;
    this.namespace = namespace ?? getBucketCacheKey(env);
  }

  private async readBacking<T>(
    fileName: string,
    prefix: "current/" | "" = "current/",
  ): Promise<{ value: T; source: "r2" | "bundled" }> {
    if (this.env.DATA_BUCKET) {
      const r2Key = prefix ? `${prefix}${fileName}` : fileName;
      const obj = await this.env.DATA_BUCKET.get(r2Key);
      if (obj) {
        const value = (await obj.json()) as T;
        return { value, source: "r2" };
      }
    }

    const assetUrl = `https://assets.local/data/${fileName}`;
    const res = await this.env.ASSETS.fetch(new Request(assetUrl));
    if (res.ok) {
      const value = (await res.json()) as T;
      return { value, source: "bundled" };
    }

    throw new Error(`Data file not found in R2 or ASSETS: ${fileName} (status ${res.status})`);
  }

  async getManifestWithSource(): Promise<{
    manifest: Manifest;
    source: "r2" | "bundled";
  }> {
    const cacheKey = `${this.namespace}:manifest`;
    const now = Date.now();
    const cached = isolateCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return {
        manifest: cached.value as Manifest,
        source: cached.source,
      };
    }

    const { value, source } = await this.readBacking<Manifest>("manifest.json");
    const versionTag = `${value.bcdVersion}:${value.webFeaturesVersion}:${value.generatedAt}`;
    isolateCache.set(cacheKey, {
      value,
      source,
      versionTag,
      expiresAt: now + MANIFEST_TTL_MS,
    });
    return { manifest: value, source };
  }

  async getManifest(): Promise<Manifest> {
    const { manifest } = await this.getManifestWithSource();
    return manifest;
  }

  private async getCachedJson<T>(fileName: string): Promise<T> {
    const manifest = await this.getManifest();
    const versionTag = `${manifest.bcdVersion}:${manifest.webFeaturesVersion}:${manifest.generatedAt}`;
    const cacheKey = `${this.namespace}:${fileName}`;
    const now = Date.now();
    const cached = isolateCache.get(cacheKey);
    if (cached && cached.expiresAt > now && cached.versionTag === versionTag) {
      return cached.value as T;
    }

    const { value, source } = await this.readBacking<T>(fileName);
    isolateCache.set(cacheKey, {
      value,
      source,
      versionTag,
      expiresAt: now + MEMORY_TTL_MS,
    });
    return value;
  }

  async getBrowsers(): Promise<BrowserMeta[]> {
    return this.getCachedJson<BrowserMeta[]>("browsers.json");
  }

  async getPrecomputed(): Promise<PrecomputedData> {
    return this.getCachedJson<PrecomputedData>("precomputed.json");
  }

  async getWebFeatures(): Promise<CompactWebFeature[]> {
    return this.getCachedJson<CompactWebFeature[]>("web-features.json");
  }

  async getCategoryFeatures(cat: CategorySlug): Promise<CompactFeature[]> {
    const manifest = await this.getManifest();
    const shards = manifest.categoryShards?.[cat];
    if (!shards || shards.length === 0) {
      return this.getCachedJson<CompactFeature[]>(`cat-${cat}.json`);
    }
    if (shards.length === 1) {
      return this.getCachedJson<CompactFeature[]>(shards[0].file);
    }
    const parts = await Promise.all(
      shards.map((s) => this.getCachedJson<CompactFeature[]>(s.file)),
    );
    return parts.flat();
  }

  async getCategoriesFeatures(
    cats: readonly CategorySlug[],
  ): Promise<CompactFeature[]> {
    const unique = [...new Set(cats)];
    const lists = await Promise.all(
      unique.map((cat) => this.getCategoryFeatures(cat)),
    );
    return lists.flat();
  }

  async lookupFeature(id: string): Promise<FeatureLookupResult | null> {
    let cleanId = "";
    try {
      cleanId = decodeURIComponent(id).trim();
    } catch {
      return null;
    }
    if (!cleanId) return null;

    const webFeatures = await this.getWebFeatures();
    const wf = webFeatures.find((item) => item.id === cleanId);
    if (wf) {
      // Load only shards matching compatKeysSample for rich detail without loading unnecessary categories
      const manifest = await this.getManifest();
      const targetFiles = new Set<string>();
      for (const ck of wf.compatKeysSample) {
        const cat = ck.split(".")[0] as CategorySlug;
        const shards = manifest.categoryShards?.[cat];
        if (!shards) continue;
        for (const shard of shards) {
          if (ck >= shard.firstId && ck <= shard.lastId) {
            targetFiles.add(shard.file);
          }
        }
      }
      const shardArrays = await Promise.all(
        [...targetFiles].map((f) => this.getCachedJson<CompactFeature[]>(f)),
      );
      const sampleSet = new Set(wf.compatKeysSample);
      const relatedBcdFeatures = shardArrays
        .flat()
        .filter((f) => sampleSet.has(f.id));

      return {
        kind: "web-feature",
        webFeature: wf,
        relatedBcdFeatures,
      };
    }

    const topCat = cleanId.split(".")[0];
    if ((CATEGORIES as readonly string[]).includes(topCat)) {
      const cat = topCat as CategorySlug;
      const manifest = await this.getManifest();
      const shards = manifest.categoryShards?.[cat] ?? [
        { file: `cat-${cat}.json`, count: 0, firstId: "", lastId: "" },
      ];
      const matchingShards = shards.filter(
        (s) => !s.firstId || (cleanId >= s.firstId && cleanId <= s.lastId),
      );
      const candidates = matchingShards.length > 0 ? matchingShards : shards;
      for (const shard of candidates) {
        const rows = await this.getCachedJson<CompactFeature[]>(shard.file);
        const found = rows.find((f) => f.id === cleanId);
        if (found) {
          const parentWf = found.wf
            ? webFeatures.find((item) => item.id === found.wf)
            : undefined;
          return {
            kind: "bcd",
            bcdFeature: found,
            webFeature: parentWf,
          };
        }
      }
    }

    return null;
  }

  async getSyncStatus(): Promise<SyncStatus | null> {
    const cacheKey = `${this.namespace}:sync-status`;
    const now = Date.now();
    const cached = isolateCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.value as SyncStatus | null;
    }

    let status: SyncStatus | null = null;
    if (this.env.DATA_BUCKET) {
      try {
        const obj = await this.env.DATA_BUCKET.get("sync-status.json");
        if (obj) {
          status = (await obj.json()) as SyncStatus;
        }
      } catch {
        status = null;
      }
    }

    isolateCache.set(cacheKey, {
      value: status,
      source: this.env.DATA_BUCKET ? "r2" : "bundled",
      versionTag: "sync-status",
      expiresAt: now + MANIFEST_TTL_MS,
    });
    return status;
  }

  async getHistory(): Promise<HistorySnapshot[]> {
    const cacheKey = `${this.namespace}:history`;
    const now = Date.now();
    const cached = isolateCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.value as HistorySnapshot[];
    }

    const history = await getHistorySnapshots(this.env);
    isolateCache.set(cacheKey, {
      value: history,
      source: this.env.DATA_BUCKET ? "r2" : "bundled",
      versionTag: "history",
      expiresAt: now + MANIFEST_TTL_MS,
    });
    return history;
  }
}
