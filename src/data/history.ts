import type { Env, HistorySnapshot } from "../types.ts";

export async function getHistorySnapshots(env: Env): Promise<HistorySnapshot[]> {
  if (env.DATA_BUCKET) {
    try {
      const obj = await env.DATA_BUCKET.get("history.json");
      if (obj) {
        const parsed = (await obj.json()) as HistorySnapshot[];
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // fall through to bundled seed
    }
  }

  try {
    const res = await env.ASSETS.fetch(
      new Request("https://assets.local/data/history-seed.json"),
    );
    if (res.ok) {
      const seed = (await res.json()) as HistorySnapshot[];
      if (Array.isArray(seed)) return seed;
    }
  } catch {
    // ignore
  }

  return [];
}

export async function appendHistorySnapshot(
  env: Env,
  snapshot: HistorySnapshot,
): Promise<HistorySnapshot[]> {
  const existing = await getHistorySnapshots(env);
  const alreadyPresent = existing.some(
    (s) =>
      s.bcdVersion === snapshot.bcdVersion &&
      s.webFeaturesVersion === snapshot.webFeaturesVersion,
  );
  const updated = alreadyPresent
    ? existing.map((s) =>
        s.bcdVersion === snapshot.bcdVersion &&
        s.webFeaturesVersion === snapshot.webFeaturesVersion
          ? snapshot
          : s
      )
    : [...existing, snapshot];

  // Keep up to 365 most recent snapshots
  const trimmed = updated.slice(-365);

  if (env.DATA_BUCKET) {
    await env.DATA_BUCKET.put("history.json", JSON.stringify(trimmed, null, 2), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
  }

  return trimmed;
}
