import type { Env } from "../env";

/**
 * Runs an Apify actor synchronously and returns its dataset items.
 * Actor IDs are overridable via the `apify_actors` setting so you can swap
 * scrapers from the admin without redeploying.
 */
export const DEFAULT_ACTORS = {
  instagramHashtag: "apify~instagram-hashtag-scraper",
  instagramProfile: "apify~instagram-scraper",
  aliexpress: "piotrv1001~aliexpress-listings-scraper",
  alibaba: "piotrv1001~alibaba-listings-scraper",
  temu: "amit123~temu-products-scraper",
  shein: "lexis-solutions~shein-scraper",
};

export async function runActor<T = any>(env: Env, actor: string, input: unknown, timeoutSecs = 240): Promise<T[]> {
  if (!env.APIFY_TOKEN) throw new Error("APIFY_TOKEN not set");
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=${timeoutSecs}&clean=true`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.APIFY_TOKEN}` },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`Apify ${actor} ${r.status}: ${await r.text()}`);
  return r.json();
}

export interface ReelSignal {
  id: string; url: string; caption: string; hashtags: string[]; image: string;
  likes: number; comments: number; views: number; postedAt: number;
}

export async function scrapeInstagram(env: Env, hashtags: string[], accounts: string[], limit = 40): Promise<ReelSignal[]> {
  const out: any[] = [];
  if (hashtags.length)
    out.push(...(await runActor(env, DEFAULT_ACTORS.instagramHashtag, { hashtags, resultsType: "reels", resultsLimit: limit })));
  if (accounts.length)
    out.push(...(await runActor(env, DEFAULT_ACTORS.instagramProfile, {
      directUrls: accounts.map((a) => `https://www.instagram.com/${a.replace("@", "")}/reels/`),
      resultsType: "posts", resultsLimit: limit,
    })));
  return out.map((p) => ({
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
