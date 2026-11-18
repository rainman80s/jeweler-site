import type { Env } from "../env";
import { setting, uid } from "../lib/util";

/**
 * Apify integration.
 *
 * Scrapes take minutes, but a Worker request may only keep working ~30s after responding.
 * So we never wait: `startActor` kicks off a run and registers an Apify webhook that calls
 * /api/apify/webhook when the run finishes; that request then pulls the results and processes them.
 */
export const DEFAULT_ACTORS = {
  instagramHashtag: "apify~instagram-hashtag-scraper",
  instagramProfile: "apify~instagram-scraper",
  aliexpress: "devcake~aliexpress-products-scraper",
  alibaba: "devcake~alibaba-products-scraper",
  temu: "crw~temu-products-scraper",
  shein: "omkar-cloud~shein-scraper",
};

export type RunMeta = { kind: "instagram" } | { kind: "supplier"; supplier: string; trendId: string; keyword: string };

const auth = (env: Env) => ({ authorization: `Bearer ${env.APIFY_TOKEN}` });

export async function webhookSecret(env: Env): Promise<string> {
  let s = await setting<string>(env, "webhook_secret", "");
  if (!s) {
    s = crypto.randomUUID().replace(/-/g, "");
    await env.DB.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('webhook_secret', ?)").bind(JSON.stringify(s)).run();
    s = await setting<string>(env, "webhook_secret", s);
  }
  return s;
}

/** Starts an actor run without waiting. Returns the Apify run id. */
export async function startActor(env: Env, actor: string, input: unknown, meta: RunMeta): Promise<string> {
  if (!env.APIFY_TOKEN) throw new Error("APIFY_TOKEN not set");
  const origin = await setting<string>(env, "site_origin", "");
  if (!origin) throw new Error("site address unknown — open the admin dashboard once, then retry");
  const id = uid();
  const webhooks = [{
    eventTypes: ["ACTOR.RUN.SUCCEEDED", "ACTOR.RUN.FAILED", "ACTOR.RUN.TIMED_OUT", "ACTOR.RUN.ABORTED"],
    requestUrl: `${origin}/api/apify/webhook?secret=${await webhookSecret(env)}&run=${id}`,
  }];
  const r = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?webhooks=${btoa(JSON.stringify(webhooks))}`, {
    method: "POST", headers: { ...auth(env), "content-type": "application/json" }, body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`Apify ${actor} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d: any = await r.json();
  await env.DB.prepare("INSERT INTO apify_runs (id, apify_run_id, actor, meta, status) VALUES (?,?,?,?, 'running')")
    .bind(id, d.data.id, actor, JSON.stringify(meta)).run();
  return d.data.id;
}

export async function getRun(env: Env, apifyRunId: string): Promise<any> {
  const r = await fetch(`https://api.apify.com/v2/actor-runs/${apifyRunId}`, { headers: auth(env) });
  return (await r.json<any>()).data;
}

export async function getDataset<T = any>(env: Env, datasetId: string, limit = 200): Promise<T[]> {
  const r = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&limit=${limit}`, { headers: auth(env) });
  if (!r.ok) throw new Error(`Apify dataset ${r.status}`);
  return r.json();
}

export interface ReelSignal {
  id: string; url: string; caption: string; hashtags: string[]; image: string;
  likes: number; comments: number; views: number; postedAt: number;
}

export async function startInstagramScan(env: Env, hashtags: string[], accounts: string[], limit = 40): Promise<number> {
  let n = 0;
  if (hashtags.length) { await startActor(env, DEFAULT_ACTORS.instagramHashtag, { hashtags, resultsType: "reels", resultsLimit: limit }, { kind: "instagram" }); n++; }
  if (accounts.length) {
    await startActor(env, DEFAULT_ACTORS.instagramProfile, {
      directUrls: accounts.map((a) => `https://www.instagram.com/${a.replace("@", "")}/reels/`), resultsType: "posts", resultsLimit: limit,
    }, { kind: "instagram" });
    n++;
  }
  return n;
}

export function toReels(items: any[]): ReelSignal[] {
  return items.filter((p) => p && (p.id || p.shortCode) && !p.error).map((p) => ({
    id: String(p.id ?? p.shortCode),
    url: p.url ?? `https://www.instagram.com/reel/${p.shortCode}/`,
    caption: p.caption ?? "",
    hashtags: p.hashtags ?? [],
    image: p.displayUrl ?? p.thumbnailUrl ?? "",
    likes: p.likesCount ?? 0,
    comments: p.commentsCount ?? 0,
    views: p.videoViewCount ?? p.videoPlayCount ?? 0,
    postedAt: p.timestamp ? Math.floor(Date.parse(p.timestamp) / 1000) : 0,
  }));
}
