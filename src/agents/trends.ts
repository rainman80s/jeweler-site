import type { Env } from "../env";
import { startInstagramScan, type ReelSignal } from "../integrations/apify";
import { chatJSON } from "../integrations/openai";
import { now, setting, uid } from "../lib/util";
import { extractStyles } from "../lib/jewelry";

/**
 * scanTrends: starts Apify Instagram scrapes (returns immediately).
 * processReels: runs when Apify's webhook says the scrape finished —
 *  1) score each reel by engagement velocity (engagement per hour since posting)
 *  2) extract shoppable style keywords (OpenAI if connected, keyword dictionary otherwise)
 *  3) roll keywords up into `trends` with momentum (decayed running score)
 */
export async function scanTrends(env: Env) {
  const hashtags = await setting<string[]>(env, "hashtags", []);
  const accounts = await setting<string[]>(env, "accounts", []);
  if (!hashtags.length && !accounts.length) throw new Error("no hashtags or accounts set — add some in settings");
  const runs = await startInstagramScan(env, hashtags, accounts);
  return { scrapes_started: runs, note: "results arrive in a few minutes via Apify webhook" };
}

export async function processReels(env: Env, reels: ReelSignal[]) {
  const scored = reels.map((r) => {
    const hours = Math.max(1, (now() - (r.postedAt || now() - 86400)) / 3600);
    const engagement = r.likes + r.comments * 4 + r.views * 0.05;
    return { ...r, score: engagement / Math.pow(hours, 0.8) };
  }).sort((a, b) => b.score - a.score);

  const stmts = scored.map((r) => env.DB.prepare(
    `INSERT INTO trend_signals (id,source,source_id,url,caption,hashtags,image_url,likes,comments,views,posted_at,score)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source,source_id) DO UPDATE SET likes=excluded.likes, views=excluded.views, score=excluded.score`
  ).bind(uid(), "instagram", r.id, r.url, r.caption.slice(0, 2000), JSON.stringify(r.hashtags), r.image, r.likes, r.comments, r.views, r.postedAt, r.score));
  if (stmts.length) await env.DB.batch(stmts);

  const top = scored.slice(0, 40);
  if (!top.length) return { reels: 0 };
  let styles: { keyword: string; idx: number[] }[] = [];
  if (env.OPENAI_API_KEY) {
    ({ styles } = await chatJSON<{ styles: { keyword: string; idx: number[] }[] }>(env,
      `You are a jewelry trend analyst. From Instagram reel captions, extract specific, searchable jewelry product styles
       a dropshipper could source on AliExpress (e.g. "chunky gold dome huggie earrings", "freshwater pearl charm necklace").
       Return JSON {"styles":[{"keyword":string,"idx":[reel indexes]}]}. 5-15 styles. Skip non-jewelry.`,
      top.map((r, i) => `[${i}] ${r.caption.slice(0, 300)} ${r.hashtags.join(" ")}`).join("\n")));
  } else {
    // No OpenAI: match captions + hashtags against a jewelry style dictionary
    const map = new Map<string, number[]>();
    top.forEach((r, i) => extractStyles(r.caption + " " + r.hashtags.join(" ")).forEach((k) => map.set(k, [...(map.get(k) ?? []), i])));
    styles = [...map].sort((a, b) => b[1].length - a[1].length).slice(0, 15).map(([keyword, idx]) => ({ keyword, idx }));
  }
  for (const s of styles ?? []) {
    const kw = s.keyword.toLowerCase().trim();
    const boost = (s.idx ?? []).reduce((a, i) => a + (top[i]?.score ?? 0), 0);
    await env.DB.prepare(
      `INSERT INTO trends (id, keyword, momentum, signal_count, last_seen) VALUES (?,?,?,?,?)
       ON CONFLICT(keyword) DO UPDATE SET momentum = momentum*0.7 + excluded.momentum,
         signal_count = signal_count + excluded.signal_count, last_seen = excluded.last_seen`
    ).bind(uid(), kw, boost, s.idx?.length ?? 0, now()).run();
  }
  return { reels: reels.length, styles: styles?.length ?? 0 };
}
